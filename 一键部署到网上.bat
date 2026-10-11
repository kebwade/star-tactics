@echo off
chcp 936 >nul
cd /d "%~dp0"
title 科币战争 - 一键部署到网上
mode con: cols=104 lines=42 >nul 2>nul
echo.
echo   把游戏发到 GitHub Pages —— 别人（包括手机）打开一个网址就能玩
echo   ==================================================
echo   ^· 不需要装 git，也不需要懂命令行
echo   ^· 第一次会问你要一个 GitHub Token（脚本会一步一步告诉你怎么办）
echo   ^· 发完会打印一个 https://你的名字.github.io/star-tactics/ 的地址
echo   ^· 等 1~2 分钟构建，然后就能把地址发给别人了
echo.
echo   等它问 Token 的时候：在这个黑窗口里点一下 —— 右键粘贴 —— 按回车。
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\部署到GitHub.ps1"
echo.
pause
