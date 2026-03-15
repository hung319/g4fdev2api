"""
Example client code showing how to use the G4F OpenAI-Compatible API
with the standard OpenAI Python library.
"""

from openai import OpenAI
import os

# Initialize the OpenAI client to point to your local G4F API
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "fake-key-required-but-not-used"),  # G4F doesn't require real keys but SDK does
    base_url="http://localhost:8000/v1"  # Point to your local G4F API
)

def chat_completion_example():
    print("=== Chat Completion Example ===")
    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "What is the capital of France?"}
            ],
            temperature=0.7,
            max_tokens=100
        )
        
        print("Response:")
        print(response.choices[0].message.content)
        print()
    except Exception as e:
        print(f"Error in chat completion: {e}")
        print()

def text_completion_example():
    print("=== Text Completion Example ===")
    try:
        response = client.completions.create(
            model="gpt-3.5-turbo",
            prompt="The future of artificial intelligence",
            max_tokens=100,
            temperature=0.7
        )
        
        print("Response:")
        print(response.choices[0].text)
        print()
    except Exception as e:
        print(f"Error in text completion: {e}")
        print()

def list_models_example():
    print("=== List Models Example ===")
    try:
        response = client.models.list()
        
        print("Available models:")
        for model in response.data:
            print(f"  - {model.id}")
        print()
    except Exception as e:
        print(f"Error listing models: {e}")
        print()

def image_generation_example():
    print("=== Image Generation Example ===")
    try:
        response = client.images.generate(
            model="dalle-3",
            prompt="a white siamese cat sitting in a garden",
            n=1,
            size="1024x1024"
        )
        
        print("Generated image URL:")
        print(response.data[0].url)
        print()
    except Exception as e:
        print(f"Error in image generation: {e}")
        print()

if __name__ == "__main__":
    print("G4F OpenAI-Compatible API Client Examples")
    print("Make sure the API server is running on http://localhost:8000/v1")
    print()
    
    # Run examples
    list_models_example()
    chat_completion_example()
    text_completion_example()
    # Note: Image generation might not be fully implemented in the basic version
    # image_generation_example()