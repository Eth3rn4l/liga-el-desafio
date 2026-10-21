@echo off
cd /d "%~dp0"
title Bot Liga El Desafio - no cerrar esta ventana
powercfg /change standby-timeout-ac 0 >nul 2>&1
:inicio
node --no-deprecation bot.js --liga ambas
echo.
echo El bot se detuvo. Se vuelve a abrir en 15 segundos (cierra la ventana para terminar)...
timeout /t 15 >nul
goto inicio
