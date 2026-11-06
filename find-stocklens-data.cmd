@echo off
cd /d "%~dp0"
node scripts\find-legacy-data.mjs %*
pause
