import sys
mode = sys.argv[2] if len(sys.argv) > 2 else 'w'
content = sys.stdin.read()
with open(sys.argv[1], mode, encoding='utf-8') as f:
    f.write(content)
print('written', len(content), 'chars to', sys.argv[1], 'mode', mode)
