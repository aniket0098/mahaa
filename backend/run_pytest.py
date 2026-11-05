import subprocess
import sys
import os

# Set up environment variables BEFORE running python
env = os.environ.copy()
env['PYTHONPATH'] = 'C:\\mahaa\\backend'
env['TEST_DATABASE_URL'] = 'postgresql+psycopg://postgres@localhost:5432/mahaa_learning_test'
env['PYTHONASYNCIO_EVENTLOOP_POLICY'] = 'windowsSelector'

# Run pytest directly
result = subprocess.run(
    [sys.executable, "-m", "pytest", "tests/", "-ra", "--tb=short", "--no-header", "-q"],
    cwd="C:\\mahaa\\backend",
    env=env,
    capture_output=True,
    text=True,
    timeout=180
)

# Print summary
print("Return code:", result.returncode)
print("STDOUT:", result.stdout[-2000:] if result.stdout else "empty")
print("STDERR:", result.stderr[-2000:] if result.stderr else "empty")