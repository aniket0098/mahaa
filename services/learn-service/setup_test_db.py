"""Create a dedicated test database for PostgreSQL integration testing."""
import psycopg

conn = psycopg.connect(host="localhost", port=5432, dbname="postgres", user="postgres", connect_timeout=3)
conn.autocommit = True
cur = conn.cursor()
try:
    cur.execute("CREATE DATABASE learn_service_test")
    print("Created database learn_service_test")
except psycopg.errors.DuplicateDatabase:
    print("Database learn_service_test already exists")
cur.close()
conn.close()