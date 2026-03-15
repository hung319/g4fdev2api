"""
Test script for the G4F OpenAI-Compatible API
"""
import requests
import json

# Base URL for the API (assuming it's running locally on port 8000)
BASE_URL = "http://localhost:8000"

def test_chat_completion():
    print("Testing /v1/chat/completions endpoint...")
    url = f"{BASE_URL}/v1/chat/completions"
    
    data = {
        "model": "gpt-3.5-turbo",
        "messages": [
            {
                "role": "user",
                "content": "Say 'Hello from G4F API!' in 10 words or less."
            }
        ]
    }
    
    try:
        response = requests.post(url, json=data)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print("Success! Response:")
            print(json.dumps(result, indent=2))
            content = result["choices"][0]["message"]["content"]
            print(f"Assistant's reply: {content}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception occurred: {e}")


def test_list_models():
    print("\nTesting /v1/models endpoint...")
    url = f"{BASE_URL}/v1/models"
    
    try:
        response = requests.get(url)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print("Available models:")
            for model in result["data"]:
                print(f"  - {model['id']}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception occurred: {e}")


def test_completion():
    print("\nTesting /v1/completions endpoint...")
    url = f"{BASE_URL}/v1/completions"
    
    data = {
        "model": "gpt-3.5-turbo",
        "prompt": "Explain quantum computing in simple terms",
        "max_tokens": 100
    }
    
    try:
        response = requests.post(url, json=data)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print("Success! Response:")
            content = result["choices"][0]["text"]
            print(f"Generated text: {content[:200]}...")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception occurred: {e}")


if __name__ == "__main__":
    print("Testing G4F OpenAI-Compatible API")
    print("=" * 40)
    
    # Test the models endpoint first
    test_list_models()
    
    # Then test chat completion
    test_chat_completion()
    
    # Finally test text completion
    test_completion()