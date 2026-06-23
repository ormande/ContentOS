@echo off
setlocal

set "PORT=4179"
set "ROOT=%~dp0"
set "NODE_EXE=node"

where node >nul 2>nul
if errorlevel 1 (
  set "BUNDLED_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if exist "%BUNDLED_NODE%" (
    set "NODE_EXE=%BUNDLED_NODE%"
  ) else (
    echo Nao encontrei Node.js neste computador.
    echo Instale Node.js ou rode o ContentOS pelo Codex.
    pause
    exit /b 1
  )
)

cd /d "%ROOT%"
start "" "http://localhost:%PORT%"
"%NODE_EXE%" "%ROOT%server.mjs" %PORT%

pause
