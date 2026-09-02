# 智慧通訊網頁佈告欄啟動腳本 (PowerShell)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  啟動 智慧通訊網頁佈告欄 (LINE & Google Chat)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

Write-Host "[1/2] 檢查並安裝 Python 相依套件..." -ForegroundColor Yellow
pip install -r requirements.txt

Write-Host ""
Write-Host "[2/2] 啟動伺服器 (http://localhost:8765)..." -ForegroundColor Green

Start-Process "http://localhost:8765"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8765 --reload
