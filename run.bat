@echo off
chcp 65001 >nul
echo ========================================================
echo   啟動 智慧通訊網頁佈告欄 (LINE ^& Google Chat)
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/2] 檢查並安裝 Python 相依套件...
pip install -r requirements.txt

echo.
echo [2/2] 啟動 FastAPI 服務與佈告欄網頁 (Port: 8765)...
echo 佈告欄網址: http://localhost:8765
echo.

start http://localhost:8765
python -m uvicorn app.main:app --host 0.0.0.0 --port 8765 --reload

pause
