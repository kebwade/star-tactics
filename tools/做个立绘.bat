@echo off
chcp 936 >nul
cd /d "%~dp0.."
echo.
echo   做个立绘 - 把图片转成 art\棋子id.png
echo   ==================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0做个立绘.ps1" -List
echo.
set /p IMG=  把图片拖到这个窗口里然后回车（或直接粘贴路径）: 
set IMG=%IMG:"=%
set /p UID=  棋子 id（上面列表里的，例如 dagger）: 
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0做个立绘.ps1" -Image "%IMG%" -Id "%UID%"
echo.
pause