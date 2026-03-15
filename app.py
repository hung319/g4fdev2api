"""
G4F OpenAI-Compatible API Server

This script creates an API server that mimics the OpenAI API structure
but uses G4F (GPT4Free) as the backend provider. It's designed to be
drop-in compatible with existing OpenAI integrations.
"""

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from g4f.client import Client
import os
import logging
import json
import time
from typing import Optional, Dict, Any
import g4f
from g4f import models
from g4f.Provider import ProviderType
import asyncio
import requests
from g4f.models import ModelRegistry, __models__

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variables for configuration
DEFAULT_API_KEY = os.environ.get("DEFAULT_G4F_API_KEY", "g4f-default-key")
PROXY_URL = os.environ.get("G4F_PROXY", None)
G4F_API_BASE_URL = os.environ.get("G4F_API_BASE_URL", "http://localhost:1337")


class G4FModelProvider:
    """Class to fetch and manage models from G4F"""

    @staticmethod
    def get_all_models_with_providers():
        """Fetch all models with their providers from G4F"""
        models_with_providers = {}

        try:
            # Method 1: Use the internal __models__ structure to get models and their providers
            from g4f.models import __models__

            for name, (model, providers) in __models__.items():
                if model is None:
                    continue  # Skip if model is None

                provider_names = []
                try:
                    if hasattr(providers, "__iter__") and not isinstance(
                        providers, (str, bytes)
                    ):
                        provider_names = [
                            p.__name__
                            if hasattr(p, "__name__") and p.__name__
                            else str(p)
                            for p in providers
                            if p is not None
                        ]
                    elif providers is not None:
                        # Handle case where providers is not iterable
                        provider_names = [
                            str(providers) if providers is not None else ""
                        ]

                    base_provider = (
                        getattr(model, "base_provider", "unknown") or "unknown"
                    )
                    models_with_providers[name] = {
                        "base_provider": base_provider,
                        "providers": provider_names,
                        "model_obj": model,
                    }
                except Exception as e:
                    logger.warning(f"Error processing model {name}: {e}")
                    # Add the model with minimal info if there's an error
                    base_provider = (
                        getattr(model, "base_provider", "unknown")
                        if model
                        else "unknown"
                    )
                    models_with_providers[name] = {
                        "base_provider": base_provider or "unknown",
                        "providers": [],
                        "model_obj": model,
                    }
        except Exception as e:
            logger.warning(f"Could not fetch models from __models__: {e}")
            # Fallback - iterate through models.__dict__
            try:
                for model_name, model_obj in models.__dict__.items():
                    if (
                        model_obj is not None
                        and not model_name.startswith("_")
                        and hasattr(model_obj, "name")
                        and hasattr(model_obj, "base_provider")
                    ):
                        base_provider = (
                            getattr(model_obj, "base_provider", "unknown") or "unknown"
                        )
                        models_with_providers[model_name] = {
                            "base_provider": base_provider,
                            "providers": [],
                            "model_obj": model_obj,
                        }
            except Exception as e2:
                logger.error(f"Error in fallback model fetching: {e2}")

        return models_with_providers

    @staticmethod
    def get_providers():
        """Fetch available providers from G4F"""
        try:
            # Try to fetch from running G4F server or remote G4F API
            G4F_API_URLS = [
                G4F_API_BASE_URL,
                "https://g4f.space/api/auto",  # Auto provider selection endpoint
                "https://g4f.space/v1",  # Hosted instance
            ]

            for base_url in G4F_API_URLS:
                try:
                    response = requests.get(
                        f"{base_url.rstrip('/')}/v1/providers", timeout=5
                    )
                    if response.status_code == 200:
                        return response.json()
                except:
                    continue
        except:
            pass

        # Fallback: Return provider names from g4f.Provider module
        import g4f.Provider

        providers = []
        for attr_name in dir(g4f.Provider):
            attr = getattr(g4f.Provider, attr_name)
            try:
                # Check if it's a valid provider class
                if (
                    hasattr(attr, "__bases__")
                    and any("Provider" in str(base) for base in attr.__bases__)
                    and hasattr(attr, "__name__")
                ):
                    provider_info = {
                        "id": attr_name,
                        "name": getattr(attr, "__name__", attr_name),
                        "class": attr,
                    }
                    providers.append(provider_info)
            except:
                # Skip if there's an issue accessing the attribute
                continue
        return providers


# Initialize G4F client (will be reinitialized with custom settings when needed)
# We'll initialize with proxy if available
initial_client_kwargs = {}
if PROXY_URL:
    initial_client_kwargs["proxies"] = PROXY_URL

try:
    client = Client(**initial_client_kwargs)
except:
    client = Client()  # fallback without proxy

# Store for conversation histories (in production, use a proper DB)
conversations = {}


def validate_api_key():
    """Validate the API key from the request headers"""
    auth_header = request.headers.get("Authorization")

    # If no API key is required (empty DEFAULT_API_KEY), allow all requests
    if not DEFAULT_API_KEY:
        return True

    # If API key is required but not provided
    if not auth_header or not auth_header.startswith("Bearer "):
        return False

    api_key = auth_header.split(" ")[1]
    # In production, you'd want to check against a list of valid API keys
    # For this implementation, we'll allow the default key or any non-empty key
    return api_key and api_key.strip() != ""


def get_client_with_options(
    provider=None, image_provider=None, api_key=None, custom_proxy=None, **kwargs
):
    """Get a G4F client with custom options"""
    client_kwargs = {}

    # Use custom proxy if provided, otherwise use global proxy
    proxy_to_use = custom_proxy or PROXY_URL
    if proxy_to_use:
        client_kwargs["proxies"] = proxy_to_use

    # Add API key if provided
    if api_key and api_key != DEFAULT_API_KEY:
        client_kwargs["api_key"] = api_key

    # Add custom provider if specified
    if provider:
        # Find the provider class by name
        provider_obj = getattr(g4f.Provider, provider, None)
        if provider_obj:
            client_kwargs["provider"] = provider_obj
        else:
            # Try to match provider name case-insensitively
            for attr_name in dir(g4f.Provider):
                attr = getattr(g4f.Provider, attr_name)
                if (
                    hasattr(attr, "__name__")
                    and attr.__name__.lower() == provider.lower()
                ):
                    client_kwargs["provider"] = attr
                    break

    # Add image provider if specified
    if image_provider:
        image_provider_obj = getattr(g4f.Provider, image_provider, None)
        if image_provider_obj:
            client_kwargs["image_provider"] = image_provider_obj
        else:
            # Try to match image provider name case-insensitively
            for attr_name in dir(g4f.Provider):
                attr = getattr(g4f.Provider, attr_name)
                if (
                    hasattr(attr, "__name__")
                    and attr.__name__.lower() == image_provider.lower()
                ):
                    client_kwargs["image_provider"] = attr
                    break

    # Merge with any additional kwargs provided
    client_kwargs.update(kwargs)

    try:
        return Client(**client_kwargs)
    except Exception as e:
        logger.warning(
            f"Failed to create client with options: {e}, using default client"
        )
        return Client()  # fallback


class ChatCompletionResponse:
    """Helper class to format chat completion responses in OpenAI format"""

    @staticmethod
    def create_response(
        model: Optional[str] = None,
        content: str = "",
        conversation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        response_id = f"chatcmpl-{int(time.time())}"
        content_str = content or ""
        model_str = model or "gpt-3.5-turbo"
        return {
            "id": response_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model_str,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content_str},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": len(content_str.split()),  # Approximate
                "completion_tokens": len(content_str.split()),  # Approximate
                "total_tokens": len(content_str.split()) * 2,  # Approximate
            },
        }


@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    """Handle chat completions in OpenAI API format"""
    # Validate API key
    if not validate_api_key():
        return jsonify(
            {
                "error": {
                    "type": "authentication_error",
                    "message": "Invalid or missing API key",
                }
            }
        ), 401

    try:
        data = request.get_json()

        # Extract parameters
        model = data.get("model", "gpt-3.5-turbo")
        messages = data.get("messages", [])
        stream = data.get("stream", False)
        temperature = data.get("temperature", 0.7)
        max_tokens = data.get("max_tokens", None)
        provider = data.get("provider")  # Custom G4F provider
        api_key = request.headers.get("Authorization", "").replace(
            "Bearer ", ""
        )  # Extract API key from header
        proxy = data.get("proxy")  # Custom proxy for this request

        # Get client with custom options
        custom_client = get_client_with_options(
            provider=provider, api_key=api_key, custom_proxy=proxy
        )

        # Create the completion
        response = custom_client.chat.completions.create(
            model=model,
            messages=messages,
            stream=False,  # For now, we'll handle streaming separately if needed
            temperature=temperature,
        )

        content = (
            response.choices[0].message.content
            if response.choices and response.choices[0].message
            else None
        )

        # Format as OpenAI-compatible response
        result = ChatCompletionResponse.create_response(model, content or "")

        if stream:
            # For now, just return the response as-is
            # In a more sophisticated implementation, we'd stream the response
            def generate():
                yield json.dumps(result)

            return Response(generate(), mimetype="application/json")
        else:
            return jsonify(result)

    except Exception as e:
        logger.error(f"Error in chat_completions: {str(e)}")
        return jsonify(
            {"error": {"type": "invalid_request_error", "message": str(e)}}
        ), 400


@app.route("/v1/completions", methods=["POST"])
def completions():
    """Handle text completions (non-chat) in OpenAI API format"""
    # Validate API key
    if not validate_api_key():
        return jsonify(
            {
                "error": {
                    "type": "authentication_error",
                    "message": "Invalid or missing API key",
                }
            }
        ), 401

    try:
        data = request.get_json()

        # Extract parameters
        model = data.get("model", "gpt-3.5-turbo")
        prompt = data.get("prompt", "")
        stream = data.get("stream", False)
        temperature = data.get("temperature", 0.7)
        max_tokens = data.get("max_tokens", 256)
        provider = data.get("provider")  # Custom G4F provider
        api_key = request.headers.get("Authorization", "").replace(
            "Bearer ", ""
        )  # Extract API key from header
        proxy = data.get("proxy")  # Custom proxy for this request

        # Get client with custom options
        custom_client = get_client_with_options(
            provider=provider, api_key=api_key, custom_proxy=proxy
        )

        # Convert prompt to messages format for G4F
        messages = [{"role": "user", "content": prompt}]

        # Create the completion
        response = custom_client.chat.completions.create(
            model=model, messages=messages, stream=False, temperature=temperature
        )

        content = (
            response.choices[0].message.content
            if response.choices and response.choices[0].message
            else None
        )
        content_text = content or ""

        # Format as OpenAI-compatible response
        result = {
            "id": f"cmpl-{int(time.time())}",
            "object": "text_completion",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "text": content_text,
                    "logprobs": None,
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": len(prompt.split()),
                "completion_tokens": len(content_text.split()),
                "total_tokens": len(prompt.split()) + len(content_text.split()),
            },
        }

        if stream:

            def generate():
                yield json.dumps(result)

            return Response(generate(), mimetype="application/json")
        else:
            return jsonify(result)

    except Exception as e:
        logger.error(f"Error in completions: {str(e)}")
        return jsonify(
            {"error": {"type": "invalid_request_error", "message": str(e)}}
        ), 400


@app.route("/v1/models", methods=["GET"])
def list_models():
    """List available models from G4F"""
    try:
        # Validate API key - optional for this endpoint
        # Since this is a GET request without sensitive data, we can make it available to all
        # But in production, you might want to validate the API key here too
        available_models = []

        # Get all models with provider info from G4F using the helper class
        models_with_providers = G4FModelProvider.get_all_models_with_providers()

        # Format models in OpenAI style
        for model_name, model_info in models_with_providers.items():
            model_obj = model_info["model_obj"]

            # Safely get model ID
            model_id = (
                getattr(model_obj, "name", model_name) if model_obj else str(model_name)
            )
            if model_id is None:
                model_id = str(model_name)

            # Safely get owned_by
            owned_by = (
                getattr(
                    model_obj, "base_provider", model_info.get("base_provider", "g4f")
                )
                if model_obj
                else model_info.get("base_provider", "g4f")
            )
            if owned_by is None:
                owned_by = "g4f"

            available_models.append(
                {
                    "id": str(model_id),
                    "object": "model",
                    "created": 1677610602,  # Use a fixed timestamp for consistency
                    "owned_by": str(owned_by),
                    "providers": model_info.get(
                        "providers", []
                    ),  # Additional field with provider info
                }
            )

        # Add some common model names as fallback if the above doesn't work
        if not available_models:
            available_models = [
                {
                    "id": "gpt-3.5-turbo",
                    "object": "model",
                    "created": 1677610602,
                    "owned_by": "openai",
                },
                {
                    "id": "gpt-4",
                    "object": "model",
                    "created": 1677610602,
                    "owned_by": "openai",
                },
                {
                    "id": "gpt-4o",
                    "object": "model",
                    "created": 1677610602,
                    "owned_by": "openai",
                },
                {
                    "id": "gpt-4o-mini",
                    "object": "model",
                    "created": 1677610602,
                    "owned_by": "openai",
                },
                {
                    "id": "claude-3-haiku",
                    "object": "model",
                    "created": 1677610602,
                    "owned_by": "anthropic",
                },
                {
                    "id": "llama-3.1-70b",
                    "object": "model",
                    "created": 1677610602,
                    "owned_by": "meta",
                },
                {
                    "id": "gemini-pro",
                    "object": "model",
                    "created": 1677610602,
                    "owned_by": "google",
                },
                {
                    "id": "mixtral-8x7b",
                    "object": "model",
                    "created": 1677610602,
                    "owned_by": "mistral",
                },
            ]

        return jsonify({"object": "list", "data": available_models})
    except Exception as e:
        logger.error(f"Error in list_models: {str(e)}")
        # Return basic models as fallback
        basic_models = [
            {
                "id": "gpt-3.5-turbo",
                "object": "model",
                "created": 1677610602,
                "owned_by": "openai",
            },
            {
                "id": "gpt-4",
                "object": "model",
                "created": 1677610602,
                "owned_by": "openai",
            },
            {
                "id": "gpt-4o",
                "object": "model",
                "created": 1677610602,
                "owned_by": "openai",
            },
            {
                "id": "gpt-4o-mini",
                "object": "model",
                "created": 1677610602,
                "owned_by": "openai",
            },
        ]
        return jsonify({"object": "list", "data": basic_models})


@app.route("/v1/providers", methods=["GET"])
def list_providers():
    """List available providers from G4F"""
    try:
        # Get providers from G4F
        providers = G4FModelProvider.get_providers()

        # Format providers in a consistent way
        formatted_providers = []
        for provider in providers:
            if isinstance(provider, dict):
                formatted_providers.append(
                    {
                        "id": provider.get("id", provider.get("name", "unknown")),
                        "object": "provider",
                        "created": int(time.time()),
                        "owned_by": "g4f",
                        "capabilities": provider.get("capabilities", []),
                        "auth_required": provider.get("auth", False),
                    }
                )
            else:
                # Handle if provider is a string or other format
                formatted_providers.append(
                    {
                        "id": str(provider),
                        "object": "provider",
                        "created": int(time.time()),
                        "owned_by": "g4f",
                        "capabilities": [],
                        "auth_required": False,
                    }
                )

        return jsonify({"object": "list", "data": formatted_providers})
    except Exception as e:
        logger.error(f"Error in list_providers: {str(e)}")
        # Return empty list as fallback
        return jsonify({"object": "list", "data": []})


@app.route("/v1/config", methods=["GET"])
def get_config():
    """Get API configuration"""
    try:
        # Get all models with providers
        models_with_providers = G4FModelProvider.get_all_models_with_providers()

        config = {
            "api_key_required": bool(DEFAULT_API_KEY),
            "proxy_configured": bool(PROXY_URL),
            "g4f_api_base_url": G4F_API_BASE_URL,
            "total_models": len(models_with_providers),
            "models_with_providers": models_with_providers,
            "available_providers": G4FModelProvider.get_providers(),
        }

        return jsonify(config)
    except Exception as e:
        logger.error(f"Error in get_config: {str(e)}")
        return jsonify(
            {
                "api_key_required": bool(DEFAULT_API_KEY),
                "proxy_configured": bool(PROXY_URL),
                "g4f_api_base_url": G4F_API_BASE_URL,
                "total_models": 0,
                "models_with_providers": {},
                "available_providers": [],
            }
        )


@app.route("/v1/images/generations", methods=["POST"])
def images_generations():
    """Handle image generation in OpenAI API format"""
    # Validate API key
    if not validate_api_key():
        return jsonify(
            {
                "error": {
                    "type": "authentication_error",
                    "message": "Invalid or missing API key",
                }
            }
        ), 401

    try:
        data = request.get_json()

        prompt = data.get("prompt", "")
        model = data.get("model", "dalle-3")
        n = data.get("n", 1)
        size = data.get("size", "1024x1024")
        response_format = data.get("response_format", "url")
        image_provider = data.get("image_provider")  # Custom G4F image provider
        api_key = request.headers.get("Authorization", "").replace(
            "Bearer ", ""
        )  # Extract API key from header
        proxy = data.get("proxy")  # Custom proxy for this request

        # Get client with custom options for image generation
        custom_client = get_client_with_options(
            image_provider=image_provider, api_key=api_key, custom_proxy=proxy
        )

        # Generate image using G4F
        response = custom_client.images.generate(
            model=model, prompt=prompt, response_format=response_format
        )

        # Convert to OpenAI format - be safe about response.data
        image_data = []
        if hasattr(response, "data") and response.data:
            for img in response.data:
                if hasattr(img, "url"):
                    image_data.append({"url": img.url})
                elif hasattr(img, "b64_json"):
                    image_data.append({"b64_json": img.b64_json})

        result = {"created": int(time.time()), "data": image_data}

        return jsonify(result)

    except Exception as e:
        logger.error(f"Error in images_generations: {str(e)}")
        return jsonify(
            {"error": {"type": "invalid_request_error", "message": str(e)}}
        ), 400


@app.route("/", methods=["GET"])
def health_check():
    """Basic health check"""
    return jsonify(
        {"status": "ok", "service": "G4F OpenAI-Compatible API", "version": "1.0.0"}
    )


@app.errorhandler(404)
def not_found(error):
    return jsonify(
        {
            "error": {
                "type": "not_found_error",
                "message": "The requested resource was not found",
            }
        }
    ), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify(
        {
            "error": {
                "type": "server_error",
                "message": "An internal server error occurred",
            }
        }
    ), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"

    logger.info(f"Starting G4F OpenAI-Compatible API server on {host}:{port}")
    app.run(host=host, port=port, debug=debug)
