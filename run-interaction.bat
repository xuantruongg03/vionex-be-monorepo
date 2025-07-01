@echo off
echo Starting Vionex Interaction Service...
cd /d "d:\Github\videocall\vionex-backend\vionex-interaction-service"
REM Start the service
echo Starting Interaction Service on port 50055...
npm run start:dev

pause
