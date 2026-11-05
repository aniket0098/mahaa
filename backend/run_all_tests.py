#!/usr/bin/env python
import subprocess
import sys
import os

# Set up environment variables
env = os.environ.copy()
env['PYTHONPATH'] = r'C:\mahaa\backend'
env['TEST_DATABASE_URL'] = 'postgresql+psycopg://postgres@localhost:5432/mahaa_learning_test'
env['PYTHONASYNCIO_EVENTLOOP_POLICY'] = 'windowsSelector'

# Run pytest
result = subprocess.run(
    [sys.executable, "-m", "pytest", "tests/", "-ra", "--tb=short", "--no-header", "-q"],
    cwd=r'C:\mahaa\backend',
    env=env,
    capture_output=True,
    text=True,
    timeout=300
)

# Write results to file
with open('C:\\mahaa\\backend\\test_results.txt', 'w') as f:
    f.write("Return code: " + str(result.returncode) + "\n")
    f.write("STDOUT:\n" + result.stdout[-5000:] + "\n")
    f.write("STDERR:\n" + result.stderr[-5000:] + "\n")

print("Tests complete. Return code:", result.returncode)
print("Output written to C:\\mahaa\\backend\\test_results.txt")