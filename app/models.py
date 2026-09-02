from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

class PlatformType(str, Enum):
    LINE = "LINE"
    GOOGLE_CHAT = "GOOGLE_CHAT"
    SIMULATION = "SIMULATION"

class MessageCategory(str, Enum):
    MENTION_ME = "MENTION_ME"       # @個人訊息/待辦
    ANNOUNCEMENT = "ANNOUNCEMENT"   # 全域宣導事項
    IGNORE = "IGNORE"               # 一般閒聊 (不進入佈告欄)

class PriorityLevel(str, Enum):
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    URGENT = "URGENT"

class BulletinMessage(BaseModel):
    id: str = Field(..., description="唯一辨識碼")
    platform: PlatformType
    channel_name: str = Field(..., description="來源群組或頻道名稱")
    sender_name: str = Field(..., description="發送者名稱")
    content: str = Field(..., description="原始內容")
    category: MessageCategory
    priority: PriorityLevel = PriorityLevel.NORMAL
    matched_reason: str = Field(default="", description="觸發篩選之規則理由")
    is_read: bool = False
    is_resolved: bool = False
    is_pinned: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    raw_payload: Optional[Dict[str, Any]] = None

class SimulationPayload(BaseModel):
    platform: PlatformType = PlatformType.LINE
    channel_name: str = "專案架構討論群"
    sender_name: str = "技術主管"
    content: str = "@Alex 請於今日下班前確認 API 規格書與佈告欄原型驗證"
    mentions: Optional[List[str]] = None

class ProfileUpdateRequest(BaseModel):
    name: str
    aliases: List[str]
    line_user_ids: List[str]
    google_emails: List[str]
    announcement_keywords: List[str]
