@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
set "APP_EXIT=%ERRORLEVEL%"
if not "%APP_EXIT%"=="0" (
    echo.
    echo Wence exited with an error.
    pause
)
exit /b %APP_EXIT%
