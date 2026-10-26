@echo off
rem Abre o APAGAO no navegador (precisa de Python 3 instalado).
cd /d "%~dp0"
python tools\serve.py 8765
if errorlevel 1 (
  echo.
  echo Nao consegui iniciar com "python". Tentando "py"...
  py tools\serve.py 8765
)
pause
