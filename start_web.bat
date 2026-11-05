@echo off
cd /d C:\mahaa
start "Expo Web Server" cmd /c "npx expo start --web --port 19006"
echo Expo web server started. Check browser at http://localhost:19006
timeout /t 5