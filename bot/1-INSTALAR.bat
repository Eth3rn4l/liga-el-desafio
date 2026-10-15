@echo off
cd /d "%~dp0"
echo Instalando el bot (tarda unos minutos)...
call npm install
if not exist config.json copy config.ejemplo.json config.json >nul
echo.
echo Listo. Ahora abre 2-VINCULAR-Y-VER-GRUPOS.bat
pause
