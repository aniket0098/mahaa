#!/usr/bin/env python
import os
import sys

# Set the test database URL
os.environ["TEST_DATABASE_URL"] = "postgresql+psycopg://postgres@localhost:5432/mahaa_learning_test"

# Run pytest
sys.exit(os.system("python -m pytest tests/ -ra --tb=short"))