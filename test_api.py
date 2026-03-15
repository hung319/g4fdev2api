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
                "content": "Say 'Hello from G4F API!' in 10 words or less.",
            }
        ],
    }

    # Add headers for API key if required
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer g4f-default-key",
    }

    try:
        response = requests.post(url, json=data, headers=headers)
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


def test_chat_completion_with_provider():
    print("\nTesting /v1/chat/completions with specific provider...")
    url = f"{BASE_URL}/v1/chat/completions"

    data = {
        "model": "gpt-4",
        "messages": [{"role": "user", "content": "What is the meaning of life?"}],
        "provider": "OpenaiChat",  # Use specific provider
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer g4f-default-key",
    }

    try:
        response = requests.post(url, json=data, headers=headers)
        print(f"Status Code: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            print("Success! Response with provider:")
            content = result["choices"][0]["message"]["content"]
            print(f"Assistant's reply: {content[:200]}...")  # Truncate long responses
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception occurred: {e}")


def test_list_models():
    print("\nTesting /v1/models endpoint...")
    url = f"{BASE_URL}/v1/models"

    headers = {"Authorization": "Bearer g4f-default-key"}

    try:
        response = requests.get(url, headers=headers)
        print(f"Status Code: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            print(f"Available models: {len(result['data'])}")
            for model in result["data"][:5]:  # Show first 5 models
                print(f"  - {model['id']} (owned by: {model['owned_by']})")
            if len(result["data"]) > 5:
                print(f"  ... and {len(result['data']) - 5} more")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception occurred: {e}")


def test_list_providers():
    print("\nTesting /v1/providers endpoint...")
    url = f"{BASE_URL}/v1/providers"

    headers = {"Authorization": "Bearer g4f-default-key"}

    try:
        response = requests.get(url, headers=headers)
        print(f"Status Code: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            print(f"Available providers: {len(result['data'])}")
            for provider in result["data"][:5]:  # Show first 5 providers
                print(f"  - {provider['id']}")
            if len(result["data"]) > 5:
                print(f"  ... and {len(result['data']) - 5} more")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception occurred: {e}")


def test_config():
    print("\nTesting /v1/config endpoint...")
    url = f"{BASE_URL}/v1/config"

    headers = {"Authorization": "Bearer g4f-default-key"}

    try:
        response = requests.get(url, headers=headers)
        print(f"Status Code: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            print("Configuration:")
            print(f"  API Key Required: {result.get('api_key_required')}")
            print(f"  Proxy Configured: {result.get('proxy_configured')}")
            print(f"  G4F API Base URL: {result.get('g4f_api_base_url')}")
            print(f"  Total Models: {result.get('total_models')}")
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
        "max_tokens": 100,
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer g4f-default-key",
    }

    try:
        response = requests.post(url, json=data, headers=headers)
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
    print("=" * 50)

    # Test configuration first
    test_config()

    # Test the models endpoint
    test_list_models()

    # Test the providers endpoint
    test_list_providers()

    # Test chat completion
    test_chat_completion()

    # Test chat completion with specific provider
    test_chat_completion_with_provider()

    # Test text completion
    test_completion()
