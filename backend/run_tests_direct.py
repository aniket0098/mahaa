#!/usr/bin/env python
import subprocess
import sys
import os

# Set up environment variables
env = os.environ.copy()
env['PYTHONPATH'] = r'C:\mahaa\backend'
env['TEST_DATABASE_URL'] = 'postgresql+psycopg://postgres@localhost:5432/mahaa_learning_test'
env['PYTHONASYNCIO_EVENTLOOP_POLICY'] = 'windowsSelector'

# Run a single test file first to verify infrastructure
test_file = sys.argv[1] if len(sys.argv) > 1 else 'tests/test_health.py'

print(f"Running: {test_file}")
print(f"PYTHONPATH: {env['PYTHONPATH']}")
print(f"TEST_DATABASE_URL set: {'YES' if env.get('TEST_DATABASE_URL') else 'NO'}")

result = subprocess.run(
    [sys.executable, "-m", "pytest", test_file, "-ra", "--tb=short", "--no-header", "-q"],
    cwd=r'C:\mahaa\backend',
    env=env,
    capture_output=True,
    text=True,
    timeout=120
)

print("\n" + "="*60)
print("Return code:", result.returncode)
print("STDOUT:", result.stdout if result.stdout else "empty")
print("STDERR:", result.stderr if result.stderr else "empty")
print("="*60)