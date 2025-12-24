@echo off
REM --- Fully automatic Apache + Python server start ---

echo Starting Apache server...
cd "C:\xampp"
start "" "apache_start.bat"

REM Wait a few seconds to ensure Apache is running
timeout /t 5

echo Starting Python server...
cd "C:\xampp\htdocs\WA-PDF-Sender"
"C:\Users\Shan\AppData\Local\Python\bin\python.exe" server.py

pause
