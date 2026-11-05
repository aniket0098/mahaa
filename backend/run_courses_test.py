#!/usr/bin/env python3
import os
os.environ["DATABASE_URL"] = "postgresql+psycopg://postgres@localhost:5432/mahaa_test"

import subprocess
import sys

# Run the courses test file
result = subprocess.run(
    [sys.executable, "-m", "pytest", "tests/test_courses.py", "-v"],
    cwd="C:/mahaa/backend",
    capture_output=True,
    text=True,
    timeout=120
)

print("=" * 60)
print("RETURN CODE:", result.returncode)
print("=" * 60)
print("STDOUT:")
print(result.stdout[-3000:] if len(result.stdout) > 3000 else result.stdout)
print("STDERR:")
print(result.stderr[-3000:] if len(result.stderr) > 3000 else result.stderr)