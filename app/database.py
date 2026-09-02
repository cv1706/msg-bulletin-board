import sqlite3
import json
import os
from typing import List, Optional, Dict, Any
from app.models import BulletinMessage, PlatformType, MessageCategory, PriorityLevel

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "bulletin.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL,
        matched_reason TEXT,
        is_read INTEGER DEFAULT 0,
        is_resolved INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        raw_payload TEXT
    )
    """)
    conn.commit()
    conn.close()

def save_message(msg: BulletinMessage):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT OR REPLACE INTO messages (
        id, platform, channel_name, sender_name, content,
        category, priority, matched_reason, is_read, is_resolved,
        is_pinned, created_at, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        msg.id,
        msg.platform.value,
        msg.channel_name,
        msg.sender_name,
        msg.content,
        msg.category.value,
        msg.priority.value,
        msg.matched_reason,
        1 if msg.is_read else 0,
        1 if msg.is_resolved else 0,
        1 if msg.is_pinned else 0,
        msg.created_at,
        json.dumps(msg.raw_payload, ensure_ascii=False) if msg.raw_payload else None
    ))
    conn.commit()
    conn.close()

def get_messages(category: Optional[str] = None, platform: Optional[str] = None, is_resolved: Optional[bool] = None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = "SELECT * FROM messages WHERE 1=1"
    params = []
    
    if category:
        query += " AND category = ?"
        params.append(category)
    if platform:
        query += " AND platform = ?"
        params.append(platform)
    if is_resolved is not None:
        query += " AND is_resolved = ?"
        params.append(1 if is_resolved else 0)
        
    query += " ORDER BY is_pinned DESC, created_at DESC LIMIT 200"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    results = []
    for r in rows:
        results.append({
            "id": r["id"],
            "platform": r["platform"],
            "channel_name": r["channel_name"],
            "sender_name": r["sender_name"],
            "content": r["content"],
            "category": r["category"],
            "priority": r["priority"],
            "matched_reason": r["matched_reason"],
            "is_read": bool(r["is_read"]),
            "is_resolved": bool(r["is_resolved"]),
            "is_pinned": bool(r["is_pinned"]),
            "created_at": r["created_at"],
            "raw_payload": json.loads(r["raw_payload"]) if r["raw_payload"] else None
        })
    conn.close()
    return results

def update_message_status(msg_id: str, is_read: Optional[bool] = None, is_resolved: Optional[bool] = None, is_pinned: Optional[bool] = None) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    
    updates = []
    params = []
    if is_read is not None:
        updates.append("is_read = ?")
        params.append(1 if is_read else 0)
    if is_resolved is not None:
        updates.append("is_resolved = ?")
        params.append(1 if is_resolved else 0)
    if is_pinned is not None:
        updates.append("is_pinned = ?")
        params.append(1 if is_pinned else 0)
        
    if not updates:
        conn.close()
        return False
        
    params.append(msg_id)
    query = f"UPDATE messages SET {', '.join(updates)} WHERE id = ?"
    cursor.execute(query, params)
    conn.commit()
    affected = cursor.rowcount > 0
    conn.close()
    return affected

def delete_message(msg_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
    conn.commit()
    affected = cursor.rowcount > 0
    conn.close()
    return affected

def clear_all_messages():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM messages")
    conn.commit()
    conn.close()
