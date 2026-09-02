# 智慧通訊網頁佈告欄 (LINE & Google Chat)

一套專為 LINE 與 Google Chat 設計的智慧訊息篩選與即時佈告欄系統，自動分流「@個人的訊息與待辦」以及「全域宣導與重要公告」。

---

## 核心特性

* **雙軌智慧篩選**：自動精準辨識 @個人 訊息（LINE ID / Google Email / 暱稱別名）與全域宣導公告（@all、[公告]、重要通知等）。
* **無關閒聊過濾**：自動排除普通對話，維持看板整潔。
* **WebSocket 即時推播**：訊息即時更新於網頁看板，免手動重新整理，附帶柔和提示音。
* **狀態管理**：提供「標記完成」、「置頂公告」、「刪除」與過濾功能。
* **內建模擬測試器**：無需正式 Bot 憑證即可在介面一鍵模擬發送各類情境訊息進行測試。

---

## 專案結構

```
msg-bulletin-board/
├── app/
│   ├── classifier.py         # 訊息篩選與分類引擎
│   ├── database.py           # SQLite 資料庫存取模組
│   ├── main.py               # FastAPI 核心服務與 Webhook 端點
│   ├── models.py             # Pydantic 資料模型
│   ├── websocket_manager.py  # WebSocket 即時推播管理員
│   └── static/               # 前端靜態資源
│       ├── css/style.css     # 深色主題樣式
│       ├── js/app.js         # 前端應用邏輯
│       └── index.html        # 網頁佈告欄頁面
├── config.json               # 使用者身分與關鍵字設定
├── requirements.txt          # Python 相依套件清單
├── run.bat                   # Windows 批次啟動腳本
├── run.ps1                   # PowerShell 啟動腳本
├── test_system.py            # 整合測試腳本
└── README.md                 # 專案說明文件
```

---

## 快速啟動

### 1. 執行啟動腳本
雙擊 `run.bat` 或在終端機中執行：
```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8765 --reload
```

### 2. 開啟瀏覽器
開啟：`http://localhost:8765`

### 3. 執行測試
```bash
python test_system.py
```

---

## Webhook 串接端點

* **LINE Messaging API**：`POST /api/webhook/line`
* **Google Chat**：`POST /api/webhook/google-chat`
* **模擬測試 API**：`POST /api/webhook/simulate`
