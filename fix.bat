@echo off  
cd c:\mahaa  
:: Fix 1: backslash-quotes  
powershell -nop -c \" "%1\  
exit /b 
