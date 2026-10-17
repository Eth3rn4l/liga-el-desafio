@echo off
cd /d "%~dp0"
title Bot Liga El Desafio - no cerrar esta ventana
powercfg /change standby-timeout-ac 0 >nul 2>&1
echo.
echo  Que liga va a manejar el bot?
echo    1) Liga Precon
echo    2) Liga Bracket 3
echo    3) Las dos
choice /c 123 /n /m "  Presiona 1, 2 o 3: "
if errorlevel 3 (set LIGA=ambas) else if errorlevel 2 (set LIGA=b3) else (set LIGA=precon)
echo.
choice /c SN /n /m "  Mandar ahora al grupo el mensaje para inscribirse? (S/N): "
if errorlevel 2 (set INV=) else (set INV=--invitar)
echo.
:inicio
node bot.js --liga %LIGA% %INV%
rem Si se reinicia, no se repite el mensaje de inscripcion
set INV=
echo.
echo El bot se detuvo. Se vuelve a abrir en 15 segundos (cierra la ventana para terminar)...
timeout /t 15 >nul
goto inicio
