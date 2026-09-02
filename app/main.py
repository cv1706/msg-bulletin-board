import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List, Dict, Any

from app.models import (
    BulletinMessage, SimulationPayload, ProfileUpdateRequest,
    PlatformType, MessageCategory, PriorityLevel
)
from app.database import (
    init_db, save_message, get_messages, update_message_status,
    delete_message, clear_all_messages
)
from app.classifier import MessageClassifier, load_config, save_config
from app.websocket_manager import ws_manager

app = FastAPI(title="智慧通訊網頁佈告欄 (LINE & Google Chat)")

# 允許跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化資料庫
init_db()

# 掛載靜態資源目錄
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)

# ----------------- Webhook 接收端點 -----------------

@app.post("/api/webhook/line")
async def line_webhook(request: Request):
    """接收 LINE Messaging API Webhook 事件"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    messages = MessageClassifier.parse_line_webhook(body)
    saved_count = 0
    for msg in messages:
        save_message(msg)
        await ws_manager.broadcast("NEW_MESSAGE", msg.model_dump())
        saved_count += 1

    return {"status": "ok", "captured_messages": saved_count}

@app.post("/api/webhook/google-chat")
async def google_chat_webhook(request: Request):
    """接收 Google Chat App / Workspace Events Webhook"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    msg = MessageClassifier.parse_google_chat_webhook(body)
    if msg:
        save_message(msg)
        await ws_manager.broadcast("NEW_MESSAGE", msg.model_dump())
        return {"status": "ok", "captured": True, "message_id": msg.id}

    return {"status": "ok", "captured": False, "note": "Message does not match filter"}

@app.post("/api/webhook/simulate")
async def simulate_message(payload: SimulationPayload):
    """模擬發送訊息，用於本機測試與即時演示"""
    msg = MessageClassifier.classify_text(
        text=payload.content,
        mentions=payload.mentions,
        sender=payload.sender_name,
        channel=payload.channel_name,
        platform=payload.platform
    )
    if msg:
        save_message(msg)
        await ws_manager.broadcast("NEW_MESSAGE", msg.model_dump())
        return {"status": "success", "captured": True, "message": msg.model_dump()}
    
    return {
        "status": "ignored",
        "captured": False,
        "note": "此訊息為一般對話，未觸發 @個人、@團隊 或 宣導事項 規則"
    }

# ----------------- 訊息管理 API -----------------

@app.get("/api/messages")
def list_messages(
    category: Optional[str] = None,
    platform: Optional[str] = None,
    is_resolved: Optional[bool] = None,
    days: Optional[int] = None
):
    """取得訊息列表，支援天數過濾 (例如 days=3)"""
    return get_messages(category=category, platform=platform, is_resolved=is_resolved, days=days)

@app.post("/api/messages/sync")
def sync_local_messages(local_messages: List[Dict[str, Any]]):
    """客戶端本地快照與伺服器資料庫雙向同步 (防止無狀態雲端容器重啟丟失資料)"""
    for item in local_messages:
        try:
            msg = BulletinMessage(**item)
            save_message(msg)
        except Exception:
            pass
    return {"status": "synced", "count": len(local_messages)}

@app.patch("/api/messages/{msg_id}")
async def patch_message(
    msg_id: str,
    is_read: Optional[bool] = Body(None),
    is_resolved: Optional[bool] = Body(None),
    is_pinned: Optional[bool] = Body(None)
):
    success = update_message_status(msg_id, is_read=is_read, is_resolved=is_resolved, is_pinned=is_pinned)
    if not success:
        raise HTTPException(status_code=404, detail="Message not found")
    await ws_manager.broadcast("UPDATE_MESSAGE", {
        "id": msg_id, "is_read": is_read, "is_resolved": is_resolved, "is_pinned": is_pinned
    })
    return {"status": "updated", "id": msg_id}

@app.delete("/api/messages/{msg_id}")
async def delete_msg(msg_id: str):
    success = delete_message(msg_id)
    if not success:
        raise HTTPException(status_code=404, detail="Message not found")
    await ws_manager.broadcast("DELETE_MESSAGE", {"id": msg_id})
    return {"status": "deleted", "id": msg_id}

@app.delete("/api/messages")
async def clear_messages():
    clear_all_messages()
    await ws_manager.broadcast("CLEAR_MESSAGES", {})
    return {"status": "all_cleared"}

# ----------------- 統計與設定 API -----------------

@app.get("/api/stats")
def get_stats():
    all_msgs = get_messages()
    my_mentions = sum(1 for m in all_msgs if m["category"] == MessageCategory.MENTION_ME.value)
    unresolved_my_mentions = sum(1 for m in all_msgs if m["category"] == MessageCategory.MENTION_ME.value and not m["is_resolved"])
    team_mentions = sum(1 for m in all_msgs if m["category"] == MessageCategory.MENTION_TEAM.value)
    unresolved_team = sum(1 for m in all_msgs if m["category"] == MessageCategory.MENTION_TEAM.value and not m["is_resolved"])
    announcement_count = sum(1 for m in all_msgs if m["category"] == MessageCategory.ANNOUNCEMENT.value)
    
    return {
        "total": len(all_msgs),
        "my_mentions": my_mentions,
        "unresolved_my_mentions": unresolved_my_mentions,
        "team_mentions": team_mentions,
        "unresolved_team": unresolved_team,
        "announcements": announcement_count
    }

@app.get("/api/config")
def get_system_config():
    return load_config()

@app.post("/api/config")
def update_system_config(profile: ProfileUpdateRequest):
    cfg = load_config()
    cfg["user_profile"] = {
        "name": profile.name,
        "aliases": profile.aliases,
        "line_user_ids": profile.line_user_ids,
        "google_emails": profile.google_emails
    }
    cfg["announcement_rules"]["keywords"] = profile.announcement_keywords
    save_config(cfg)
    return {"status": "saved", "config": cfg}

# ----------------- WebSocket 連線 -----------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

# ----------------- 前端頁面 -----------------

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
