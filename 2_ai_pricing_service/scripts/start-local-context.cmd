@echo off
setlocal
cd /d "%~dp0..\.."
if not exist ".tmp\local-ai\ollama-v0.40.12\ollama.exe" (
  echo Ollama runtime missing. See docs/DA_NANG_MARKET_PRICING.md.
  exit /b 1
)
set "OLLAMA_HOST=127.0.0.1:11434"
set "OLLAMA_MODELS=%CD%\.tmp\local-ai\models"
set "OLLAMA_NO_CLOUD=1"
set "OLLAMA_NUM_PARALLEL=1"
".tmp\local-ai\ollama-v0.40.12\ollama.exe" serve
