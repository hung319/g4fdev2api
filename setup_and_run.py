"""
setup_and_run.py - One-click setup and run script for G4F OpenAI-Compatible API
"""

import subprocess
import sys
import os
import time
import threading
import requests
from typing import List

def install_requirements():
    """Install required packages"""
    print("Installing required packages...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✓ Packages installed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to install packages: {e}")
        return False

def start_server():
    """Start the API server in a separate thread"""
    try:
        from app import app
        print("Starting API server on http://localhost:8000")
        app.run(host="0.0.0.0", port=8000, debug=False, threaded=True)
    except ImportError as e:
        print(f"✗ Could not start server: {e}")
    except Exception as e:
        print(f"✗ Server error: {e}")

def check_server_health(max_retries: int = 30):
    """Check if the server is responding"""
    url = "http://localhost:8000/"
    for _ in range(max_retries):
        try:
            response = requests.get(url, timeout=5)
            if response.status_code == 200:
                return True
        except requests.exceptions.RequestException:
            pass
        time.sleep(1)
    return False

def run_test():
    """Run a basic test to verify the API works"""
    print("\nRunning basic functionality test...")
    try:
        # Test models endpoint
        response = requests.get("http://localhost:8000/v1/models")
        if response.status_code == 200:
            models_data = response.json()
            print(f"✓ Successfully connected to API")
            print(f"✓ Found {len(models_data.get('data', []))} available models")
            
            # Test chat completion if models are available
            if models_data.get('data'):
                model_id = models_data['data'][0]['id']
                
                test_payload = {
                    "model": model_id,
                    "messages": [
                        {"role": "user", "content": "Hi, just testing the API!"}
                    ]
                }
                
                response = requests.post(
                    "http://localhost:8000/v1/chat/completions",
                    json=test_payload
                )
                
                if response.status_code == 200:
                    print("✓ Chat completion test successful!")
                    return True
                else:
                    print(f"✗ Chat completion failed: {response.status_code}")
                    return False
            else:
                print("✗ No models available")
                return False
        else:
            print(f"✗ Models endpoint failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ Test failed with error: {e}")
        return False

def main():
    print("🚀 Setting up G4F OpenAI-Compatible API Server")
    print("=" * 50)
    
    # Change to the project directory
    os.chdir("g4f_openai_api")
    
    # Install requirements
    if not install_requirements():
        print("\n❌ Setup failed during package installation")
        return
    
    # Start server in a thread
    print("\n🔧 Starting API server...")
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Wait a moment for the server to start
    print("⏳ Waiting for server to initialize...")
    time.sleep(3)
    
    # Check if server is running
    if check_server_health():
        print("✅ Server is running successfully!")
        print("\n🌐 API endpoints:")
        print("   http://localhost:8000/v1/chat/completions")
        print("   http://localhost:8000/v1/completions")
        print("   http://localhost:8000/v1/models")
        print("   http://localhost:8000/v1/images/generations")
        
        # Run a test
        if run_test():
            print("\n🎉 All tests passed! The API is ready to use.")
            print("\n📋 To use with OpenAI SDK:")
            print("   from openai import OpenAI")
            print("   client = OpenAI(api_key='anything', base_url='http://localhost:8000/v1')")
            print("   # Use as normal...")
        else:
            print("\n⚠️  Server is running but tests failed")
        
        print("\n💡 Press Ctrl+C to stop the server")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n🛑 Server stopped gracefully")
    else:
        print("❌ Server failed to start properly")
        return

if __name__ == "__main__":
    main()