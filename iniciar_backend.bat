@echo off
title Robson Tavernard - Backend (FastAPI :8000)
cd /d "%~dp0backend"

echo =========================================================
echo   Iniciando Servidor Backend (FastAPI - Porta 8000)
echo   Plataforma de Automacao Tactiq & Pipedrive CRM
echo =========================================================
echo.

if exist "venv\Scripts\python.exe" (
    echo [OK] Ambiente virtual detectado em backend\venv
    venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
) else (
    echo [AVISO] Venv local nao encontrado, usando python do sistema...
    python -m uvicorn main:app --reload --port 8000
)

pause
