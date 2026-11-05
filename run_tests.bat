@echo off
cd /d C:\mahaa\backend
call .venv\Scripts\activate.bat
set TEST_DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/mahaa_learning_test
echo TEST_DATABASE_URL=%TEST_DATABASE_URL%
python -m pytest tests/ -ra --tb=short > ..\test_output.txt 2>&1
echo.
echo TEST COMPLETE. Results written to ..\test_output.txt