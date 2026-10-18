@echo off
cd /d "%~dp0"
echo StockLens - open http://127.0.0.1:4173 after the server starts.
echo Keep this window open. Press Ctrl+C to stop.
call npm.cmd start
if errorlevel 1 pause
