"""
智慧通訊網頁佈告欄 - 系統整合測試腳本 (支援個人與團隊雙模式)
"""
import sys
import os
import json
import unittest

# 設定標準輸出為 UTF-8
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

# 將專案路徑加入 sys.path
sys.path.insert(0, os.path.dirname(__file__))

from app.models import PlatformType, MessageCategory, PriorityLevel
from app.classifier import MessageClassifier, load_config
from app.database import init_db, save_message, get_messages, update_message_status, clear_all_messages, clear_all_settings

class TestBulletinSystem(unittest.TestCase):
    def setUp(self):
        init_db()
        clear_all_messages()
        clear_all_settings()

    def test_01_mention_me_classification(self):
        """測試 @個人 訊息與暱稱比對"""
        text = "@Alex 請於今日下午五點前交付架構報告"
        msg = MessageClassifier.classify_text(
            text=text,
            sender="主管",
            channel="核心開發組",
            platform=PlatformType.LINE
        )
        self.assertIsNotNone(msg, "應成功識別 @個人 訊息")
        self.assertEqual(msg.category, MessageCategory.MENTION_ME)
        self.assertIn("alex", msg.matched_reason.lower())
        print("[PASS] 測試 1：成功識別 @我的交辦 訊息")

    def test_02_mention_team_classification(self):
        """測試 @其他同事 進入全團隊交辦"""
        text = "@David @Jessica 請排查伺服器連線延遲問題"
        msg = MessageClassifier.classify_text(
            text=text,
            sender="架構師",
            channel="後端組",
            platform=PlatformType.LINE
        )
        self.assertIsNotNone(msg, "應成功識別 @其他同事 訊息")
        self.assertEqual(msg.category, MessageCategory.MENTION_TEAM)
        self.assertIn("David", msg.target_users)
        self.assertIn("Jessica", msg.target_users)
        print("[PASS] 測試 2：成功識別 @全團隊交辦 訊息並標示成員")

    def test_03_announcement_classification(self):
        """測試全域宣導關鍵字過濾"""
        text = "【公告】本週五晚間十點將進行伺服器例行性維護，請提前備份。"
        msg = MessageClassifier.classify_text(
            text=text,
            sender="資訊中心",
            channel="全體廣播",
            platform=PlatformType.GOOGLE_CHAT
        )
        self.assertIsNotNone(msg, "應成功識別全域宣導事項")
        self.assertEqual(msg.category, MessageCategory.ANNOUNCEMENT)
        print("[PASS] 測試 3：成功識別全域宣導事項")

    def test_04_ignore_general_chat(self):
        """測試一般群組閒聊是否正確被忽略"""
        text = "大家今天中午要訂哪一家的便當？"
        msg = MessageClassifier.classify_text(
            text=text,
            sender="同事 A",
            channel="閒聊群",
            platform=PlatformType.LINE
        )
        self.assertIsNone(msg, "一般閒聊訊息應被忽略不進入佈告欄")
        print("[PASS] 測試 4：成功排除無關閒聊訊息")

    def test_05_line_webhook_parsing(self):
        """測試 LINE Webhook Payload 解析與 mentionees 辨識"""
        line_payload = {
            "events": [
                {
                    "type": "message",
                    "source": {
                        "type": "group",
                        "groupId": "Caabbccddeeff11223344",
                        "userId": "U9988776655"
                    },
                    "message": {
                        "type": "text",
                        "text": "請大家注意，@Alex 這個項目需要你支援！",
                        "mention": {
                            "mentionees": [
                                {
                                    "index": 6,
                                    "length": 5,
                                    "userId": "U1234567890abcdef1234567890abcdef"
                                }
                            ]
                        }
                    }
                }
            ]
        }
        messages = MessageClassifier.parse_line_webhook(line_payload)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].category, MessageCategory.MENTION_ME)
        print("[PASS] 測試 5：LINE Webhook 事件精確解析成功")

    def test_06_taipei_timezone_conversion(self):
        """測試 LINE Webhook 毫秒時間戳記轉換為台北時間 (UTC+8)"""
        # 1725676440000 為 UTC 2024-09-07 02:34:00 -> 台北時間應為 2024-09-07 10:34:00
        line_payload = {
            "events": [
                {
                    "type": "message",
                    "timestamp": 1725676440000,
                    "source": {
                        "type": "user",
                        "userId": "U12345678"
                    },
                    "message": {
                        "type": "text",
                        "text": "【公告】全體同仁請注意冷卻水塔定期檢測"
                    }
                }
            ]
        }
        messages = MessageClassifier.parse_line_webhook(line_payload)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].created_at, "2024-09-07 10:34:00")
        print("[PASS] 測試 6：LINE 原始時間戳記成功轉換為台北時間 (UTC+8)")

    def test_07_system_config_persistence(self):
        """測試設定資料庫持久化儲存與自訂身分識別"""
        from app.database import save_setting
        from app.classifier import load_config
        try:
            custom_cfg = {
                "user_profile": {
                    "name": "國寶",
                    "aliases": ["國寶", "kuobao"],
                    "line_user_ids": ["U55dbf75"],
                    "google_emails": ["kb@company.com"]
                },
                "announcement_rules": {
                    "keywords": ["【公告】", "[公告]"],
                    "high_priority_keywords": ["緊急"]
                }
            }
            save_setting("system_config", json.dumps(custom_cfg, ensure_ascii=False))
            loaded = load_config()
            self.assertEqual(loaded["user_profile"]["name"], "國寶")
            
            # 驗證 @國寶 能成功進入 @我的交辦
            msg = MessageClassifier.classify_text(
                text="@國寶 請確認分子篩更換進度",
                sender="主管",
                channel="工務組",
                platform=PlatformType.LINE
            )
            self.assertIsNotNone(msg)
            self.assertEqual(msg.category, MessageCategory.MENTION_ME)
            print("[PASS] 測試 7：設定持久化與自訂身分比對成功")
        finally:
            clear_all_settings()

    def test_08_reclassify_messages(self):
        """測試動態更新身分後，自動重新校準歷史訊息為 @我的交辦"""
        from app.database import reclassify_all_messages, save_setting, get_messages
        # 先以初始身分 (Alex) 存入一則 @國寶 的訊息 (進入 MENTION_TEAM)
        msg = MessageClassifier.classify_text(
            text="@國寶 請確認英業達分子篩更換發包進度",
            mentions=["Uf5aa5d73", "國寶"],
            sender="主管",
            channel="工務組",
            platform=PlatformType.LINE
        )
        self.assertEqual(msg.category, MessageCategory.MENTION_TEAM)
        save_message(msg)

        # 隨後使用者將身分設定改為包含「國寶」
        custom_cfg = {
            "user_profile": {
                "name": "國寶",
                "aliases": ["國寶"],
                "line_user_ids": [],
                "google_emails": []
            },
            "announcement_rules": {"keywords": []}
        }
        save_setting("system_config", json.dumps(custom_cfg, ensure_ascii=False))

        # 執行重新校準
        updated = reclassify_all_messages()
        self.assertEqual(updated, 1)

        # 驗證該筆歷史訊息已升級為 MENTION_ME
        messages = get_messages()
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["category"], MessageCategory.MENTION_ME.value)
        print("[PASS] 測試 8：歷史訊息成功自動校準為 @我的交辦")

if __name__ == "__main__":
    unittest.main()



