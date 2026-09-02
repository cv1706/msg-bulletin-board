"""
智慧通訊網頁佈告欄 - 系統整合測試腳本
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
from app.database import init_db, save_message, get_messages, update_message_status, clear_all_messages

class TestBulletinSystem(unittest.TestCase):
    def setUp(self):
        init_db()
        clear_all_messages()

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
        print("[PASS] 測試 1：成功識別 @個人 訊息")

    def test_02_announcement_classification(self):
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
        print("[PASS] 測試 2：成功識別全域宣導事項")

    def test_03_ignore_general_chat(self):
        """測試一般群組閒聊是否正確被忽略"""
        text = "大家今天中午要訂哪一家的便當？"
        msg = MessageClassifier.classify_text(
            text=text,
            sender="同事 A",
            channel="閒聊群",
            platform=PlatformType.LINE
        )
        self.assertIsNone(msg, "一般閒聊訊息應被忽略不進入佈告欄")
        print("[PASS] 測試 3：成功排除無關閒聊訊息")

    def test_04_line_webhook_parsing(self):
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
        print("[PASS] 測試 4：LINE Webhook 事件精確解析成功")

    def test_05_database_crud(self):
        """測試資料庫寫入與狀態更新"""
        msg = MessageClassifier.classify_text(
            text="@Alex 測試待辦",
            sender="Tester",
            channel="測試頻道",
            platform=PlatformType.SIMULATION
        )
        save_message(msg)
        
        # 查詢
        records = get_messages(category=MessageCategory.MENTION_ME.value)
        self.assertEqual(len(records), 1)
        self.assertFalse(records[0]["is_resolved"])

        # 標記完成
        update_message_status(msg.id, is_resolved=True)
        updated_records = get_messages(category=MessageCategory.MENTION_ME.value)
        self.assertTrue(updated_records[0]["is_resolved"])
        print("[PASS] 測試 5：資料庫 CRUD 與狀態更新運作正常")

if __name__ == "__main__":
    unittest.main()
