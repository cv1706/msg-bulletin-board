# 智慧通訊網頁佈告欄 (LINE & Google Chat)

一套專為 LINE 與 Google Chat 設計的智慧訊息篩選與即時佈告欄系統。支援「**個人專屬 @我 模式**」與「**全團隊 @任何人 模式**」共存切換，並自動分流全域宣導與公告事項，全面排除日常閒聊。

---

## 核心特性

* **個人 / 全團隊雙模式共存**：
  * **📥 @我的交辦**：比對個人暱稱、ID 或 Email，專注個人待辦事項。
  * **👥 全團隊交辦**：群組中只要有人 @ 任何同事，自動抓取並於卡片標註 `@成員名單`，方便團隊/主管掌握整體進度。
  * **📢 全域宣導**：自動捕捉 `@all`、`[公告]`、`【宣導】`、`重要通知` 等全域標籤，分流至獨立公告區並支援置頂。
* **無關閒聊過濾**：自動排除未被標記與非公告之普通對話，維持看板乾淨。
* **WebSocket 即時推播**：訊息秒級推播至網頁看板，免手動重新整理，自帶柔和提示音。
* **三維度狀態計數**：頂部即時呈現「待處理 @我」、「團隊交辦」與「全域宣導」計數徽章。
* **多維度搜尋**：支援以「被標記者姓名（例如搜尋 David）」、「關鍵字」、「平台」或「未完成」進行篩選。
* **內建模擬測試器**：無需正式 Bot 憑證即可在介面一鍵模擬發送各類情境訊息進行驗證。

---

## 專案結構

```
msg-bulletin-board/
├── app/
│   ├── classifier.py         # 訊息篩選與分類引擎 (支援個人與團隊雙模式)
│   ├── database.py           # SQLite 資料庫存取模組
│   ├── main.py               # FastAPI 核心服務與 Webhook 端點
│   ├── models.py             # Pydantic 資料模型 (含 MENTION_TEAM)
│   ├── websocket_manager.py  # WebSocket 即時推播管理員
│   └── static/               # 前端靜態資源
│       ├── css/style.css     # 深色主題樣式與 Tab 頁籤樣式
│       ├── js/app.js         # 前端應用邏輯 (雙頁籤切換與即時渲染)
│       └── index.html        # 網頁佈告欄頁面
├── config.json               # 使用者身分與關鍵字設定
├── requirements.txt          # Python 相依套件清單
├── render.yaml               # Render 雲端自動部署藍圖
├── run.bat                   # Windows 批次啟動腳本
├── run.ps1                   # PowerShell 啟動腳本
├── push_to_github.bat        # 一鍵推送到 GitHub 工具
├── test_system.py            # 整合測試腳本
└── README.md                 # 專案說明文件
```

---

## 快速啟動

### 1. 本機啟動
雙擊 `run.bat` 或在終端機中執行：
```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8765 --reload
```
瀏覽器進入：`http://localhost:8765`

### 2. 執行自動化測試
```bash
python test_system.py
```

### 3. 雲端部署 (Render.com)
本專案已配置 `render.yaml`，推送至 GitHub 後連結 Render 即可免費 24h 雲端運作，本機無需開機。

---

## Webhook 串接端點

* **LINE Messaging API**：`POST /api/webhook/line`
* **Google Chat**：`POST /api/webhook/google-chat`
* **模擬測試 API**：`POST /api/webhook/simulate`
