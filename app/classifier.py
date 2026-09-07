import json
import os
import re
import uuid
from typing import Tuple, Optional, Dict, Any, List
from datetime import datetime
from app.models import BulletinMessage, PlatformType, MessageCategory, PriorityLevel, TAIPEI_TZ, get_taipei_now_str

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")

def load_config() -> Dict[str, Any]:
    try:
        from app.database import get_setting
        db_cfg_str = get_setting("system_config")
        if db_cfg_str:
            return json.loads(db_cfg_str)
    except Exception as e:
        print("Load config from database skipped or failed:", e)

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
    # 1. 寫入資料庫持久化
    try:
        from app.database import save_setting
        save_setting("system_config", json.dumps(cfg, ensure_ascii=False))
    except Exception as e:
        print("Save config to database failed:", e)

    # 2. 同步寫入檔案
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("Save config to file failed:", e)


class MessageClassifier:
    @staticmethod
    def extract_text_mentions(text: str) -> List[str]:
        """從文本中抽取所有 @人名 或 ＠人名"""
        pattern = r"[@＠]([a-zA-Z0-9_\u4e00-\u9fa5\.\-]+)"
        matches = re.findall(pattern, text)
        # 過濾掉 @all, @everyone 等公告標籤
        return [m for m in matches if m.lower() not in ["all", "everyone", "channel", "here"]]

    @classmethod
    def classify_text(
        cls,
        text: str,
        mentions: Optional[List[str]] = None,
        sender: str = "",
        channel: str = "",
        platform: PlatformType = PlatformType.SIMULATION,
        created_at: Optional[str] = None
    ) -> Optional[BulletinMessage]:
        config = load_config()
        user_profile = config.get("user_profile", {})
        aliases = [a.lower() for a in user_profile.get("aliases", []) if a]
        if user_profile.get("name"):
            aliases.append(user_profile.get("name", "").lower())
        line_ids = user_profile.get("line_user_ids", [])
        google_emails = [e.lower() for e in user_profile.get("google_emails", []) if e]
        
        ann_rules = config.get("announcement_rules", {})
        ann_keywords = ann_rules.get("keywords", [])
        high_priority_keywords = ann_rules.get("high_priority_keywords", [])
        
        text_lower = text.lower()
        msg_time = created_at or get_taipei_now_str()
        
        # 1. 優先判斷是否為「全域宣導事項 / 公告」
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
                target_users=["全體同仁"],
                is_pinned=(priority == PriorityLevel.URGENT),
                created_at=msg_time
            )

        # 2. 統整所有被提及的人名/ID
        all_targets = set()
        if mentions:
            for m in mentions:
                if str(m).lower() not in ["@all", "all", "everyone"]:
                    all_targets.add(str(m))
                    
        # 從文字抽取 @人名
        text_mentions = cls.extract_text_mentions(text)
        for tm in text_mentions:
            all_targets.add(tm)

        if not all_targets:
            # 無任何 @ 提及，且非公告 -> 視為一般閒聊忽略
            return None

        # 3. 判斷被提及者中是否包含「我」
        is_mention_me = False
        matched_reason = ""
        
        for target in all_targets:
            t_lower = target.lower()
            if target in line_ids:
                is_mention_me = True
                matched_reason = f"命中個人 LINE ID ({target})"
                break
            if any(email in t_lower for email in google_emails):
                is_mention_me = True
                matched_reason = f"命中個人 Google Email ({target})"
                break
            if t_lower in aliases:
                is_mention_me = True
                matched_reason = f"命中個人暱稱 (@{target})"
                break

        # 計算優先等級
        priority = PriorityLevel.NORMAL
        if any(k.lower() in text_lower for k in high_priority_keywords) or "緊急" in text or "儘速" in text or "asap" in text_lower:
            priority = PriorityLevel.URGENT
        elif "請於" in text or "截止" in text or "deadline" in text_lower:
            priority = PriorityLevel.HIGH

        if is_mention_me:
            category = MessageCategory.MENTION_ME
        else:
            category = MessageCategory.MENTION_TEAM
            matched_reason = f"標記團隊成員 ({', '.join(all_targets)})"

        return BulletinMessage(
            id=str(uuid.uuid4()),
            platform=platform,
            channel_name=channel or "一般群組",
            sender_name=sender or "同事",
            content=text.strip(),
            category=category,
            priority=priority,
            matched_reason=matched_reason,
            target_users=list(all_targets),
            created_at=msg_time
        )

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
                    
            # 提取 LINE 原始訊息時間戳記 (毫秒)
            event_ts = event.get("timestamp")
            if event_ts:
                try:
                    msg_time = datetime.fromtimestamp(event_ts / 1000.0, tz=TAIPEI_TZ).strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    msg_time = get_taipei_now_str()
            else:
                msg_time = get_taipei_now_str()

            classified = cls.classify_text(
                text=text,
                mentions=mentions,
                sender=sender_name,
                channel=channel_name,
                platform=PlatformType.LINE,
                created_at=msg_time
            )
            if classified:
                classified.raw_payload = event
                messages.append(classified)
                
        return messages

    @classmethod
    def parse_google_chat_webhook(cls, body: Dict[str, Any]) -> Optional[BulletinMessage]:
        """解析 Google Chat Webhook / Event 事件"""
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
                    
        # 提取 Google Chat 原始訊息時間 (RFC 3339 / ISO)
        create_time_str = message.get("createTime")
        if create_time_str:
            try:
                clean_time = create_time_str.replace("Z", "+00:00")
                dt = datetime.fromisoformat(clean_time).astimezone(TAIPEI_TZ)
                msg_time = dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                msg_time = get_taipei_now_str()
        else:
            msg_time = get_taipei_now_str()

        classified = cls.classify_text(
            text=text,
            mentions=mentions,
            sender=sender_name,
            channel=channel_name,
            platform=PlatformType.GOOGLE_CHAT,
            created_at=msg_time
        )
        if classified:
            classified.raw_payload = body
        return classified
