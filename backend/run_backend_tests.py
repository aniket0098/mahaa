#!/usr/bin/env python3
import os
import sys

# Set the test database URL - using mahaa_learning_test which is isolated
os.environ["TEST_DATABASE_URL"] = "postgresql+psycopg://postgres@localhost:5432/mahaa_learning_test"

# Add backend to path so app.models is importable
backend_dir = os.path.dirname(os.path.abspath(__file__))
os.environ["PYTHONPATH"] = backend_dir

# Run pytest
sys.exit(os.system("python -m pytest tests/ -ra --tb=short"))