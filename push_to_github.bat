@echo off
chcp 65001 >nul
echo ========================================================
echo   推送到 GitHub 儲存庫 (cv1706/msg-bulletin-board)
echo ========================================================
echo.

set REPO_URL=https://github.com/cv1706/msg-bulletin-board.git

echo [1/3] 加入所有變更...
git add .

echo [2/3] 提交變更 (若有)...
git commit -m "update: sync changes" 2>nul

echo [3/3] 推送程式碼至 main 分支...
git push -u origin main

echo.
echo ========================================================
echo   推送完成！
echo ========================================================
pause
