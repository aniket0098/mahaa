import psycopg2
import sys

try:
    conn = psycopg2.connect('postgresql://postgres@localhost:5432/mahaa_learning_test')
    cur = conn.cursor()
    
    # Check tables
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
    tables = [r[0] for r in cur.fetchall()]
    print('Tables in mahaa_learning_test:')
    for t in tables:
        print(f'  - {t}')
    
    # Check for expected learning tables
    learning_tables = ['courses', 'course_sections', 'course_lectures', 'enrollments', 'lecture_progress', 'saved_items']
    for lt in learning_tables:
        exists = lt in tables
        print(f'  {lt}: {"EXISTS" if exists else "MISSING"}')
    
    # Check migration head
    cur.execute("SELECT version_num FROM alembic_version")
    version = cur.fetchone()[0]
    print(f'\\nCurrent Alembic version: {version}')
    
    # Check citext extension
    cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'citext'")
    has_citext = cur.fetchone()
    print(f'  citext extension: {"PRESENT" if has_citext else "ABSENT"}')
    
    conn.close()
except Exception as e:
    print(f'Error with mahaa_learning_test: {e}', file=sys.stderr)
    sys.exit(1)

# Also check mahaa_test
print('\\n--- Now checking mahaa_test ---')
try:
    conn = psycopg2.connect('postgresql://postgres@localhost:5432/mahaa_test')
    cur = conn.cursor()
    
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
    tables = [r[0] for r in cur.fetchall()]
    print('Tables in mahaa_test:')
    for t in tables:
        print(f'  - {t}')
    
    learning_tables = ['courses', 'course_sections', 'course_lectures', 'enrollments', 'lecture_progress', 'saved_items']
    for lt in learning_tables:
        exists = lt in tables
        print(f'  {lt}: {"EXISTS" if exists else "MISSING"}')
    
    cur.execute("SELECT version_num FROM alembic_version")
    version = cur.fetchone()[0]
    print(f'\\nCurrent Alembic version: {version}')
    
    cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'citext'")
    has_citext = cur.fetchone()
    print(f'  citext extension: {"PRESENT" if has_citext else "ABSENT"}')
    
    conn.close()
except Exception as e:
    print(f'Error with mahaa_test: {e}', file=sys.stderr)