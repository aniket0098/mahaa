@echo off
cd C:/mahaa/backend
SET DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/mahaa_test
SET TEST_DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/mahaa_test
call .venv\Scripts\activate.bat
python -m pytest tests/test_enrollment.py -v --tb=short 2>&1 > NUL
echo ERRORLEVEL=%errorlevel%