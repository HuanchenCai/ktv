@echo off
rem Launch KTV backend and open browser. Pure ASCII only - Chinese Windows cmd
rem reads .bat in OEM codepage; non-ASCII bytes get mangled. See CLAUDE.md.

setlocal
cd /d %~dp0..

if not exist node_modules (
    echo [start] installing dependencies ...
    call npm install
)

if not exist web\dist (
    echo [start] building web UI ...
    call npm run build:web
)

if not exist bin\openlist.exe (
    echo [start] OpenList binary not found ^(optional - only needed for admin scan via OpenList^).
    echo         Run: npm run fetch:openlist  if you want it.
)

echo.
echo ============================================================
echo   KTV starting at http://localhost:8080
echo   Browser will open automatically in 5 seconds.
echo   Close this window to stop the server.
echo ============================================================
echo.

rem Open browser asynchronously after 5s so the server has time to come up.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:8080'"

call npm start
endlocal
