# G4F OpenAI-Compatible API

This project provides an OpenAI-compatible API wrapper around G4F (GPT4Free), allowing you to use G4F with existing OpenAI integrations without code changes.

## Overview

G4F (GPT4Free) provides free access to various language models. This API wrapper translates OpenAI API requests into G4F requests, making it easy to swap out OpenAI for G4F in existing applications.

## Features

- ✅ `/v1/chat/completions` - Chat completions (equivalent to OpenAI's endpoint)
- ✅ `/v1/completions` - Text completions (equivalent to OpenAI's endpoint)
- ✅ `/v1/models` - List available models from G4F
- ✅ `/v1/providers` - List available providers from G4F
- ✅ `/v1/images/generations` - Image generation
- ✅ `/v1/config` - Service configuration endpoint
- ✅ API Key support for authentication
- ✅ Proxy configuration support
- ✅ Provider-specific model selection
- ✅ Streaming responses support (coming soon)
- ✅ Drop-in replacement for OpenAI API

## Installation

1. Clone this repository or copy the source files:

```bash
mkdir g4f_openai_api
cd g4f_openai_api
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

## Usage

### Start the API server:

```bash
python app.py
```

By default, the server starts on `http://localhost:8000`

### Using with Python OpenAI SDK:

```python
from openai import OpenAI

# Point the OpenAI client to your local G4F API
client = OpenAI(
    api_key="your-api-key",  # Can be any value if DEFAULT_G4F_API_KEY is not set
    base_url="http://localhost:8000/v1"
)

# Use it exactly like the OpenAI API
response = client.chat.completions.create(
    model="gpt-3.5-turbo",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
```

### Using with cURL:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Endpoints

### Chat Completions
```
POST /v1/chat/completions
```

Parameters:
- `model` (string): Model name (e.g., "gpt-3.5-turbo", "gpt-4", "gpt-4o", etc.)
- `messages` (array): Array of message objects with role and content
- `temperature` (number): Sampling temperature (0.0 to 2.0)
- `stream` (boolean): Whether to stream responses
- `provider` (string): Optional specific provider to use (e.g., "OpenaiChat", "Gemini", "Perplexity")
- `proxy` (string): Optional proxy URL for this request only

### Text Completions
```
POST /v1/completions
```

Parameters:
- `model` (string): Model name
- `prompt` (string): Text prompt to complete
- `max_tokens` (integer): Maximum tokens to generate
- `temperature` (number): Sampling temperature
- `provider` (string): Optional specific provider to use
- `proxy` (string): Optional proxy URL for this request only

### Image Generation
```
POST /v1/images/generations
```

Parameters:
- `prompt` (string): Text description of the image
- `model` (string): Image generation model (e.g., "dalle-3", "flux", "gpt-image")
- `n` (integer): Number of images to generate
- `size` (string): Size of the generated images
- `response_format` (string): Format - "url", "b64_json"
- `image_provider` (string): Specific provider for image generation (e.g., "BingCreateImages")
- `proxy` (string): Optional proxy URL for this request only

### List Models
```
GET /v1/models
```

Returns a list of available models from G4F with their capabilities and providers.

### List Providers
```
GET /v1/providers
```

Returns a list of available G4F providers with their capabilities.

### Configuration
```
GET /v1/config
```

Returns service configuration including models, providers, and settings.

## Configuration

You can customize the server startup with environment variables:

- `PORT` - Port to run the server on (default: 8000)
- `HOST` - Host to bind to (default: 0.0.0.0)
- `FLASK_DEBUG` - Enable debug mode (default: false)
- `DEFAULT_G4F_API_KEY` - Default API key required (default: "g4f-default-key")
- `G4F_PROXY` - Global proxy URL to use for all requests (e.g., "http://user:pass@proxy:port")
- `G4F_API_BASE_URL` - Base URL for G4F API server (default: "http://localhost:1337")

Example:
```bash
DEFAULT_G4F_API_KEY="my-secret-key" G4F_PROXY="http://proxy.example.com:8080" python app.py
```

## Advanced Usage

### Using Specific Providers
You can specify which underlying provider to use for a request:

```python
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}],
    extra_body={"provider": "Gemini"}  # Use Gemini provider specifically
)
```

Or via cURL:
```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "provider": "Gemini"
  }'
```

### Using Proxies Per Request
You can specify a proxy URL per request:

```python
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}],
    extra_body={"proxy": "http://user:pass@proxy:port"}
)
```

## Testing

Run the test script to verify the API is working:

```bash
python test_api.py
```

## Limitations

- G4F availability may vary as it relies on free services
- Rate limits from underlying providers apply
- Some advanced OpenAI features may not be supported
- Response times may be slower than commercial APIs

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT