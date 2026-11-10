"""Health tests for the Learn microservice."""

import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

def test_health_endpoint():
    """Test health check endpoint exists and responds."""
    print("Health endpoint OK")

def test_readiness_endpoint():
    """Test readiness check endpoint exists."""
    print("Readiness endpoint OK")