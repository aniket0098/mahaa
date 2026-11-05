@echo off
cd C:/mahaa/backend
SET DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/mahaa_test
call .venv\Scripts\activate.bat
python -m pytest tests/test_courses.py -v