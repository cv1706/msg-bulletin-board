import json
import os
import re
import uuid
from typing import Tuple, Optional, Dict, Any, List
from datetime import datetime
from app.models import BulletinMessage, PlatformType, MessageCategory, PriorityLevel

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")

def load_config() -> Dict[str, Any]:
    if not os.path.exists(CONFIG_PATH):
        return {
            "user_profile": {
                "name": "Alex",
                "aliases": ["Alex", "王大明", "大明", "alex.wang"],
                "line_user_ids": [],
                "google_emails": ["alex.wang@company.com"]
            },
            "announcement_rules": {
                "keywords": ["@all", "@everyone", "[公告]", "【公告】", "[宣導]", "【宣導】", "重要通知", "請全體同仁", "全體注意"],
                "high_priority_keywords": ["緊急", "停止運作", "資安通報", "斷電通知"]
            }
        }
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(cfg: Dict[str, Any]):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

class MessageClassifier:
    @staticmethod
    def classify_text(text: str, mentions: Optional[List[str]] = None, sender: str = "", channel: str = "", platform: PlatformType = PlatformType.SIMULATION) -> Optional[BulletinMessage]:
        config = load_config()
        user_profile = config.get("user_profile", {})
        aliases = [a.lower() for a in user_profile.get("aliases", [])]
        aliases.append(user_profile.get("name", "").lower())
        line_ids = user_profile.get("line_user_ids", [])
        google_emails = [e.lower() for e in user_profile.get("google_emails", [])]
        
        ann_rules = config.get("announcement_rules", {})
        ann_keywords = ann_rules.get("keywords", [])
        high_priority_keywords = ann_rules.get("high_priority_keywords", [])
        
        text_lower = text.lower()
        
        # 1. 優先判斷是否為 @個人訊息
        is_mention_me = False
        matched_reason = ""
        
        # 檢查傳入的 mentions 標記 (LINE userId 或 Google Email)
        if mentions:
            for m in mentions:
                m_str = str(m).lower()
                if m in line_ids or any(email in m_str for email in google_emails):
                    is_mention_me = True
                    matched_reason = f"系統標記命中個人 ID ({m})"
                    break
                    
        # 若標記未命中，檢查文字中是否包含 @暱稱 或 @使用者名稱
        if not is_mention_me:
            for alias in aliases:
                if not alias:
                    continue
                pattern = rf"(@|＠){re.escape(alias)}(\s|$|[,，:：!！]|\b)"
                if re.search(pattern, text_lower):
                    is_mention_me = True
                    matched_reason = f"本文標記命中暱稱 (@{alias})"
                    break
                    
        if is_mention_me:
            # 計算優先等級
            priority = PriorityLevel.NORMAL
            if any(k.lower() in text_lower for k in high_priority_keywords) or "緊急" in text or "儘速" in text or "asap" in text_lower:
                priority = PriorityLevel.URGENT
            elif "請於" in text or "截止" in text or "deadline" in text_lower:
                priority = PriorityLevel.HIGH
                
            return BulletinMessage(
                id=str(uuid.uuid4()),
                platform=platform,
                channel_name=channel or "一般群組",
                sender_name=sender or "同事",
                content=text.strip(),
                category=MessageCategory.MENTION_ME,
                priority=priority,
                matched_reason=matched_reason,
                created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            )
            
        # 2. 判斷是否為「全域宣導事項 / 公告」
        is_announcement = False
        matched_ann_reason = ""
        
        for kw in ann_keywords:
            if kw.lower() in text_lower:
                is_announcement = True
                matched_ann_reason = f"命中宣導關鍵字 [{kw}]"
                break
                
        if is_announcement:
            priority = PriorityLevel.NORMAL
            if any(k.lower() in text_lower for k in high_priority_keywords):
                priority = PriorityLevel.URGENT
            elif "[公告]" in text or "【公告】" in text or "重大" in text:
                priority = PriorityLevel.HIGH
                
            return BulletinMessage(
                id=str(uuid.uuid4()),
                platform=platform,
                channel_name=channel or "全體廣播頻道",
                sender_name=sender or "管理處",
                content=text.strip(),
                category=MessageCategory.ANNOUNCEMENT,
                priority=priority,
                matched_reason=matched_ann_reason,
                is_pinned=(priority == PriorityLevel.URGENT),
                created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            )
            
        # 3. 一般訊息或未命中者忽略
        return None

    @classmethod
    def parse_line_webhook(cls, body: Dict[str, Any]) -> List[BulletinMessage]:
        """解析 LINE Messaging API Webhook 事件"""
        messages = []
        events = body.get("events", [])
        
        for event in events:
            if event.get("type") != "message":
                continue
            message_obj = event.get("message", {})
            if message_obj.get("type") != "text":
                continue
                
            text = message_obj.get("text", "")
            source = event.get("source", {})
            source_type = source.get("type", "user")
            
            channel_name = "LINE 私訊"
            if source_type == "group":
                channel_name = f"LINE 群組 ({source.get('groupId', '')[:6]})"
            elif source_type == "room":
                channel_name = f"LINE 聊天室 ({source.get('roomId', '')[:6]})"
                
            sender_name = source.get("userId", "LINE 用戶")[:8]
            
            # 抽取 LINE mentionees
            mentions = []
            mention_data = message_obj.get("mention", {})
            for m in mention_data.get("mentionees", []):
                if m.get("userId"):
                    mentions.append(m.get("userId"))
                if m.get("type") == "all":
                    mentions.append("@all")
                    
            classified = cls.classify_text(
                text=text,
                mentions=mentions,
                sender=sender_name,
                channel=channel_name,
                platform=PlatformType.LINE
            )
            if classified:
                classified.raw_payload = event
                messages.append(classified)
                
        return messages

    @classmethod
    def parse_google_chat_webhook(cls, body: Dict[str, Any]) -> Optional[BulletinMessage]:
        """解析 Google Chat Webhook / Event 事件"""
        event_type = body.get("type", "")
        message = body.get("message", {}) if "message" in body else body
        
        text = message.get("text", "") or message.get("formattedText", "")
        if not text:
            return None
            
        sender_obj = message.get("sender", {})
        sender_name = sender_obj.get("displayName", "Google Chat 用戶")
        
        space_obj = message.get("space", {})
        channel_name = space_obj.get("displayName") or f"Google Space ({space_obj.get('name', '')[:10]})"
        
        # 抽取 Google Chat annotations
        mentions = []
        for ann in message.get("annotations", []):
            if ann.get("type") == "USER_MENTION":
                user_meta = ann.get("userMention", {}).get("user", {})
                if user_meta.get("name"):
                    mentions.append(user_meta.get("name"))
                if user_meta.get("email"):
                    mentions.append(user_meta.get("email"))
                    
        classified = cls.classify_text(
            text=text,
            mentions=mentions,
            sender=sender_name,
            channel=channel_name,
            platform=PlatformType.GOOGLE_CHAT
        )
        if classified:
            classified.raw_payload = body
        return classified
