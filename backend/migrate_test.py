#!/usr/bin/env python3
import os
os.environ["DATABASE_URL"] = "postgresql+psycopg://postgres@localhost:5432/mahaa_test"

from alembic import command
from alembic.config import Config

config = Config("alembic.ini")
command.upgrade(config, "head")

print("Migration completed successfully")