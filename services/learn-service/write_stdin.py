import sys

p = r'C:\mahaa\services\learn-service\app\models\learning.py'
content = sys.stdin.read()
with open(p, 'w') as f:
    f.write(content)
print('Wrote', len(content), 'chars')
