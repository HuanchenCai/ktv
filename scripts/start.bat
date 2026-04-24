@echo off
rem Launch KTV backend. Pure ASCII only — Chinese Windows cmd reads .bat in OEM codepage.
rem See CLAUDE.md note about .bat encoding.

setlocal
cd /d %~dp0..
if not exist node_modules (
    echo [start] installing dependencies ...
    call npm install
)
if not exist bin\openlist.exe (
    echo [start] fetching OpenList binary ...
    call node scripts\fetch-openlist.mjs
)
if not exist web\dist (
    echo [start] building web UI ...
    call npm run build:web
)
echo [start] starting backend ...
call npm start
endlocal
