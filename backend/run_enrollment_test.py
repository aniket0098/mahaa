#!/usr/bin/env python3
import os
os.environ["DATABASE_URL"] = "postgresql+psycopg://postgres@localhost:5432/mahaa_test"
os.environ["TEST_DATABASE_URL"] = "postgresql+psycopg://postgres@localhost:5432/mahaa_test"

import subprocess
import sys

# Run the enrollment test file
result = subprocess.run(
    [sys.executable, "-m", "pytest", "tests/test_enrollment.py", "-v"],
    cwd="C:/mahaa/backend",
    capture_output=True,
    text=True,
    timeout=300
)

print("=" * 60)
print("RETURN CODE:", result.returncode)
print("=" * 60)
print("STDOUT:")
print(result.stdout[-5000:] if len(result.stdout) > 5000 else result.stdout)
print("STDERR:")
print(result.stderr[-2000:] if len(result.stderr) > 2000 else result.stderr)