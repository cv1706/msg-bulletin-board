import os
import json
import sqlite3
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from app.models import BulletinMessage, PlatformType, MessageCategory, PriorityLevel, TAIPEI_TZ

# 檢查是否配置雲端 PostgreSQL 資料庫 (例如 Render PostgreSQL 或 Supabase)
DATABASE_URL = os.environ.get("DATABASE_URL")

# 若為 Render 提供的 postgres:// 開頭，修正為 postgresql://
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "bulletin.db")

def is_postgres():
    return bool(DATABASE_URL)

def get_db_connection():
    if is_postgres():
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if is_postgres():
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id VARCHAR(64) PRIMARY KEY,
            platform VARCHAR(32) NOT NULL,
            channel_name TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            content TEXT NOT NULL,
            category VARCHAR(32) NOT NULL,
            priority VARCHAR(16) NOT NULL,
            matched_reason TEXT,
            target_users TEXT,
            is_read INTEGER DEFAULT 0,
            is_resolved INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            created_at VARCHAR(32) NOT NULL,
            raw_payload TEXT
        );
        """)
        conn.commit()
    else:
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
            target_users TEXT,
            is_read INTEGER DEFAULT 0,
            is_resolved INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            raw_payload TEXT
        );
        """)
        cursor.execute("PRAGMA table_info(messages)")
        columns = [col[1] for col in cursor.fetchall()]
        if "target_users" not in columns:
            cursor.execute("ALTER TABLE messages ADD COLUMN target_users TEXT")
        conn.commit()
        
    conn.close()

def save_message(msg: BulletinMessage):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    target_users_json = json.dumps(msg.target_users, ensure_ascii=False)
    raw_payload_json = json.dumps(msg.raw_payload, ensure_ascii=False) if msg.raw_payload else None
    
    if is_postgres():
        cursor.execute("""
        INSERT INTO messages (
            id, platform, channel_name, sender_name, content,
            category, priority, matched_reason, target_users, is_read, is_resolved,
            is_pinned, created_at, raw_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            is_read = EXCLUDED.is_read,
            is_resolved = EXCLUDED.is_resolved,
            is_pinned = EXCLUDED.is_pinned;
        """, (
            msg.id,
            msg.platform.value,
            msg.channel_name,
            msg.sender_name,
            msg.content,
            msg.category.value,
            msg.priority.value,
            msg.matched_reason,
            target_users_json,
            1 if msg.is_read else 0,
            1 if msg.is_resolved else 0,
            1 if msg.is_pinned else 0,
            msg.created_at,
            raw_payload_json
        ))
    else:
        cursor.execute("""
        INSERT OR REPLACE INTO messages (
            id, platform, channel_name, sender_name, content,
            category, priority, matched_reason, target_users, is_read, is_resolved,
            is_pinned, created_at, raw_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            msg.id,
            msg.platform.value,
            msg.channel_name,
            msg.sender_name,
            msg.content,
            msg.category.value,
            msg.priority.value,
            msg.matched_reason,
            target_users_json,
            1 if msg.is_read else 0,
            1 if msg.is_resolved else 0,
            1 if msg.is_pinned else 0,
            msg.created_at,
            raw_payload_json
        ))
        
    conn.commit()
    conn.close()

def get_messages(category: Optional[str] = None, platform: Optional[str] = None, is_resolved: Optional[bool] = None, days: Optional[int] = None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    
    param_placeholder = "%s" if is_postgres() else "?"
    query = "SELECT * FROM messages WHERE 1=1"
    params = []
    
    if category:
        query += f" AND category = {param_placeholder}"
        params.append(category)
    if platform:
        query += f" AND platform = {param_placeholder}"
        params.append(platform)
    if is_resolved is not None:
        query += f" AND is_resolved = {param_placeholder}"
        params.append(1 if is_resolved else 0)
        
    if days and days > 0:
        cutoff_date = (datetime.now(TAIPEI_TZ) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
        query += f" AND (is_pinned = 1 OR created_at >= {param_placeholder})"
        params.append(cutoff_date)
        
    query += " ORDER BY is_pinned DESC, created_at DESC LIMIT 500"
    
    cursor.execute(query, params)
    
    if is_postgres():
        import psycopg2.extras
        cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cursor.execute(query, params)
        rows = cursor.fetchall()
    else:
        rows = cursor.fetchall()
        
    results = []
    for r in rows:
        target_users = []
        if "target_users" in r.keys() and r["target_users"]:
            try:
                target_users = json.loads(r["target_users"])
            except Exception:
                target_users = []
                
        results.append({
            "id": r["id"],
            "platform": r["platform"],
            "channel_name": r["channel_name"],
            "sender_name": r["sender_name"],
            "content": r["content"],
            "category": r["category"],
            "priority": r["priority"],
            "matched_reason": r["matched_reason"],
            "target_users": target_users,
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
    
    param_placeholder = "%s" if is_postgres() else "?"
    updates = []
    params = []
    
    if is_read is not None:
        updates.append(f"is_read = {param_placeholder}")
        params.append(1 if is_read else 0)
    if is_resolved is not None:
        updates.append(f"is_resolved = {param_placeholder}")
        params.append(1 if is_resolved else 0)
    if is_pinned is not None:
        updates.append(f"is_pinned = {param_placeholder}")
        params.append(1 if is_pinned else 0)
        
    if not updates:
        conn.close()
        return False
        
    params.append(msg_id)
    query = f"UPDATE messages SET {', '.join(updates)} WHERE id = {param_placeholder}"
    cursor.execute(query, params)
    conn.commit()
    affected = cursor.rowcount > 0
    conn.close()
    return affected

def delete_message(msg_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    param_placeholder = "%s" if is_postgres() else "?"
    cursor.execute(f"DELETE FROM messages WHERE id = {param_placeholder}", (msg_id,))
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
