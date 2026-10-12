@echo off
chcp 936 >nul
cd /d "%~dp0"
title 科币战争 - 修复部署连接
mode con: cols=100 lines=42 >nul 2>nul
echo.
echo   部署现在传不上去：本机 hosts 把 api.github.com 指到了 127.0.0.1
echo   （一般是某个 GitHub/Steam 加速器或屏蔽工具写进去的）
echo.
echo   这个工具会：先备份 hosts，再把里面 github 相关的行注释掉（不删除）。
echo.
echo   ^★ 需要管理员权限。要是下面报"拒绝访问"：
echo      关掉窗口 -^> 右键这个 bat -^> 以管理员身份运行。
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\修复hosts.ps1"
echo.
pause
