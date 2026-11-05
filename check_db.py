import psycopg2
import sys

try:
    conn = psycopg2.connect('postgresql://postgres@localhost:5432')
    cur = conn.cursor()
    cur.execute('SELECT datname FROM pg_database')
    databases = sorted([r[0] for r in cur.fetchall()])
    print('Databases on localhost:5432:')
    for d in databases:
        print(f'  - {d}')
    conn.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)