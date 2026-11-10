"""Configuration tests for the Learn microservice."""

import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

def test_python_version():
    """Verify Python version is compatible."""
    import sys
    assert sys.version_info >= (3, 8), f"Python {sys.version_info} is too old"

def test_project_structure():
    """Verify the project has the expected structure."""
    import os
    from pathlib import Path
    
    project_root = Path(__file__).parent.parent
    expected_dirs = [
        "app", "app/api", "app/api/v1", "app/api/v1/endpoints",
        "app/models", "app/schemas", "app/services", "app/db",
        "tests",
    ]
    expected_files = ["Dockerfile", "requirements.txt"]

    for dir_name in expected_dirs:
        assert (project_root / dir_name).is_dir(), f"Missing directory: {dir_name}"
    for file_name in expected_files:
        assert (project_root / file_name).is_file(), f"Missing file: {file_name}"

def test_requirements_file():
    """Verify requirements.txt exists and is readable."""
    from pathlib import Path
    req_file = Path(__file__).parent.parent / "requirements.txt"
    assert req_file.is_file(), "requirements.txt not found"