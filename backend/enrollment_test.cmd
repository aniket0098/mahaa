@echo off
cd C:\mahaa\backend
set DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/mahaa_test
set TEST_DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/mahaa_test
python -m pytest tests/test_enrollment.py -v --tb=short