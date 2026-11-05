import sys
import os

# Add backend to path
sys.path.insert(0, 'C:\\mahaa\\backend')

# Set test database URL
os.environ['TEST_DATABASE_URL'] = 'postgresql+psycopg://postgres@localhost:5432/mahaa_learning_test'

# Import app.models
from app.models import Skill
print('SUCCESS: Skill imported from app.models')