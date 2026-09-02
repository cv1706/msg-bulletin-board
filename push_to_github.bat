@echo off
chcp 65001 >nul
echo ========================================================
echo   一鍵推送到 GitHub 儲存庫
echo ========================================================
echo.

set /p REPO_URL="請貼上你的 GitHub Repository 網址 (例如 https://github.com/your-name/msg-bulletin-board.git): "

if "%REPO_URL%"=="" (
    echo 網址不可為空！
    pause
    exit /b
)

echo.
echo [1/2] 設定遠端儲存庫 origin...
git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo [2/2] 推送程式碼至 main 分支...
git push -u origin main

echo.
echo ========================================================
echo   推送完成！請前往 Render.com 連接此 Repository 進行部署
echo ========================================================
pause
