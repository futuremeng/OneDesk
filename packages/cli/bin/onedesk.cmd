@echo off
rem onedesk launcher for the packaged Windows app: <install>\resources\cli\onedesk.cmd
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\OneDesk.exe" "%~dp0onedesk.cjs" %*
endlocal
