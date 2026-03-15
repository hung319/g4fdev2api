# G4F OpenAI-Compatible API

This project provides an OpenAI-compatible API wrapper around G4F (GPT4Free), allowing you to use G4F with existing OpenAI integrations without code changes.

## Overview

G4F (GPT4Free) provides free access to various language models. This API wrapper translates OpenAI API requests into G4F requests, making it easy to swap out OpenAI for G4F in existing applications.

## Features

- ✅ `/v1/chat/completions` - Chat completions (equivalent to OpenAI's endpoint)
- ✅ `/v1/completions` - Text completions (equivalent to OpenAI's endpoint)
- ✅ `/v1/models` - List available models
- ✅ `/v1/images/generations` - Image generation
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
    api_key="fake-key-required-but-not-used",  # G4F doesn't require API keys but the client does
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
  -H "Authorization: Bearer fake-key" \
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
- `model` (string): Model name (e.g., "gpt-3.5-turbo", "gpt-4")
- `messages` (array): Array of message objects with role and content
- `temperature` (number): Sampling temperature (0.0 to 2.0)
- `stream` (boolean): Whether to stream responses

### Text Completions
```
POST /v1/completions
```

Parameters:
- `model` (string): Model name
- `prompt` (string): Text prompt to complete
- `max_tokens` (integer): Maximum tokens to generate
- `temperature` (number): Sampling temperature

### List Models
```
GET /v1/models
```

Returns a list of available models.

### Image Generation
```
POST /v1/images/generations
```

Parameters:
- `prompt` (string): Text description of the image
- `model` (string): Image generation model (e.g., "dalle-3", "flux")
- `n` (integer): Number of images to generate
- `size` (string): Size of the generated images

## Configuration

You can customize the server startup with environment variables:

- `PORT` - Port to run the server on (default: 8000)
- `HOST` - Host to bind to (default: 0.0.0.0)
- `FLASK_DEBUG` - Enable debug mode (default: false)

Example:
```bash
PORT=9000 FLASK_DEBUG=true python app.py
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