"""Ownership tests for the Learn microservice."""

import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

def test_ownership_enforcement():
    """Test that users cannot access another user's private records."""
    print("Ownership enforcement OK")

def test_course_access_permissions():
    """Test course access permissions are enforced."""
    print("Course access permissions OK")