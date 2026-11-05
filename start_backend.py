import subprocess
import time
import os

os.chdir('C:/mahaa/backend')
proc = subprocess.Popen(
    ["uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)
time.sleep(3)

# Check if running
try:
    import urllib.request
    r = urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2)
    print('Backend running, status:', r.status)
except Exception as e:
    print('Backend error:', e)
    print('Stderr:', proc.stderr.read().decode()[:300] if proc.stderr else 'no stderr')