@echo off
setlocal
cd /d "%~dp0.."
set "MARKET_CONTEXT_PROVIDER=ollama"
set "MARKET_CONTEXT_MODEL=qwen3:1.7b"
set "MARKET_CONTEXT_OLLAMA_URL=http://127.0.0.1:11434/api/chat"
".venv\Scripts\python.exe" -m uvicorn app.academic_main:app --host 127.0.0.1 --port 58020
