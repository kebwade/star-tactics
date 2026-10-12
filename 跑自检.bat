@echo off
chcp 936 >nul
cd /d "%~dp0"
set PAGE=
echo.
echo   科币战争 - 自检
echo   ==================================================
echo   [1] 战斗模拟器    863 项  改过 battle.js / units.js 就跑
echo   [2] 数值平衡       12 项  改过 units/traits/items.js 就跑
echo   [3] 关卡与无尽     23 项  改过 levels.js 就跑
echo   [4] 游戏集成      635 项  改过 game.js / ui.js / arena.js / index.html / game.css 就跑
echo   [5] 全部跑一遍（共 1533 项）
echo   [0] 退出
echo.
set /p choice=  输入序号后回车: 
if "%choice%"=="1" set PAGE=tests/simtest.html
if "%choice%"=="2" set PAGE=tests/balancetest.html
if "%choice%"=="3" set PAGE=tests/levelcurve.html
if "%choice%"=="4" set PAGE=tests/gametest.html
if "%choice%"=="5" set PAGE=all
if "%choice%"=="0" exit /b 0
if not defined PAGE echo.& echo   输入无效，退出。& pause& exit /b 1
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run-tests.ps1" -Page "%PAGE%" -Budget 150000 -WindowSize 1440,900
echo.
pause