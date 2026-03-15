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
DEFAULT_API_KEY = os.environ.get("DEFAULT_G4F_API_KEY", "1")
PROXY_URL = os.environ.get("G4F_PROXY", None)
G4F_API_BASE_URL = os.environ.get("G4F_API_BASE_URL", "http://localhost:1337")


class G4FModelProvider:
    """Class to fetch and manage models from G4F"""

    @staticmethod
    def get_all_models_with_providers():
        """Fetch all models with their providers from G4F"""
        models_with_providers = {}

        # First, try to fetch models from g4f.dev API
        try:
            G4F_DEV_URLS = [
                "https://g4f.dev/api/models",
                "https://g4fapi.vercel.app/api/models",  # Fallback API
                G4F_API_BASE_URL,  # Local instance
            ]

            for base_url in G4F_DEV_URLS:
                try:
                    # Try different possible endpoints
                    urls_to_try = [
                        f"{base_url.rstrip('/')}/api/models"
                        if not base_url.endswith("/api/models")
                        else base_url,
                        f"{base_url.rstrip('/')}/v1/models",
                        f"{base_url.rstrip('/')}/models",
                    ]

                    for url in urls_to_try:
                        try:
                            response = requests.get(url, timeout=10)
                            if response.status_code == 200:
                                data = response.json()

                                # Handle different response formats
                                if isinstance(data, dict) and "models" in data:
                                    model_list = data["models"]
                                elif isinstance(data, list):
                                    model_list = data
                                else:
                                    # Assume the response is the model list itself
                                    model_list = data

                                # Process the models
                                if isinstance(model_list, list):
                                    for model_item in model_list:
                                        if isinstance(model_item, dict):
                                            if "id" in model_item:
                                                model_id = model_item["id"]
                                                base_provider = model_item.get(
                                                    "base_provider", "unknown"
                                                )
                                                providers = model_item.get(
                                                    "providers", []
                                                )
                                                models_with_providers[model_id] = {
                                                    "base_provider": base_provider,
                                                    "providers": providers
                                                    if isinstance(providers, list)
                                                    else [],
                                                    "model_obj": None,
                                                }
                                            elif "name" in model_item:
                                                model_name = model_item["name"]
                                                base_provider = model_item.get(
                                                    "base_provider", "unknown"
                                                )
                                                providers = model_item.get(
                                                    "providers", []
                                                )
                                                models_with_providers[model_name] = {
                                                    "base_provider": base_provider,
                                                    "providers": providers
                                                    if isinstance(providers, list)
                                                    else [],
                                                    "model_obj": None,
                                                }
                                    if (
                                        models_with_providers
                                    ):  # If we found models, break out of loop
                                        break
                                elif isinstance(model_list, dict):
                                    for model_id, model_info in model_list.items():
                                        if isinstance(model_info, dict):
                                            base_provider = model_info.get(
                                                "base_provider", "unknown"
                                            )
                                            providers = model_info.get("providers", [])
                                            models_with_providers[model_id] = {
                                                "base_provider": base_provider,
                                                "providers": providers
                                                if isinstance(providers, list)
                                                else [],
                                                "model_obj": None,
                                            }
                                    if (
                                        models_with_providers
                                    ):  # If we found models, break out of loop
                                        break
                        except Exception as e:
                            logger.debug(f"Error trying {url}: {e}")
                            continue
                    if (
                        models_with_providers
                    ):  # If we found models from g4f.dev, break out of outer loop
                        logger.info(
                            f"Successfully fetched {len(models_with_providers)} models from g4f.dev"
                        )
                        break
                except Exception as e:
                    logger.debug(f"Could not fetch from {base_url}: {e}")
                    continue
        except Exception as e:
            logger.warning(f"Could not fetch models from g4f.dev: {e}")

        # If still no models from g4f.dev, fall back to internal g4f models
        if not models_with_providers:
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
                                getattr(model_obj, "base_provider", "unknown")
                                or "unknown"
                            )
                            models_with_providers[model_name] = {
                                "base_provider": base_provider,
                                "providers": [],
                                "model_obj": model_obj,
                            }
                except Exception as e2:
                    logger.error(f"Error in fallback model fetching: {e2}")

        # As a final fallback, add some common models to ensure we always have something
        if not models_with_providers:
            logger.warning("No models found from any source, using fallback models")
            models_with_providers = {
                "gpt-3.5-turbo": {
                    "base_provider": "openai",
                    "providers": [
                        "Phind",
                        "FreeChat",
                        "gptgod",
                        "FreeGpt",
                        "Chatgpt4Online",
                    ],
                    "model_obj": None,
                },
                "gpt-4": {
                    "base_provider": "openai",
                    "providers": [
                        "Phind",
                        "FreeChat",
                        "gptgod",
                        "FreeGpt",
                        "Chatgpt4Online",
                    ],
                    "model_obj": None,
                },
                "gpt-4o": {
                    "base_provider": "openai",
                    "providers": [
                        "Phind",
                        "FreeChat",
                        "gptgod",
                        "FreeGpt",
                        "Chatgpt4Online",
                    ],
                    "model_obj": None,
                },
                "gpt-4o-mini": {
                    "base_provider": "openai",
                    "providers": [
                        "Phind",
                        "FreeChat",
                        "gptgod",
                        "FreeGpt",
                        "Chatgpt4Online",
                    ],
                    "model_obj": None,
                },
                "claude-3-haiku": {
                    "base_provider": "anthropic",
                    "providers": ["FreeChat", "Claude3Haiku"],
                    "model_obj": None,
                },
                "llama-3.1-70b": {
                    "base_provider": "meta",
                    "providers": ["MetaAI", "HuggingFace", "Llama3"],
                    "model_obj": None,
                },
                "gemini-pro": {
                    "base_provider": "google",
                    "providers": ["Bard", "GeminiPro", "Gemini"],
                    "model_obj": None,
                },
                "mixtral-8x7b": {
                    "base_provider": "mistral",
                    "providers": ["HuggingFace", "Mistral", "OpenaiChat"],
                    "model_obj": None,
                },
                "dall-e-2": {
                    "base_provider": "openai",
                    "providers": ["Prodia", "Pollinations"],
                    "model_obj": None,
                },
                "dall-e-3": {
                    "base_provider": "openai",
                    "providers": ["Prodia", "Pollinations"],
                    "model_obj": None,
                },
                "flux": {
                    "base_provider": "blackforestlabs",
                    "providers": ["Pollinations", "Prodia"],
                    "model_obj": None,
                },
                "playground-v2.5": {
                    "base_provider": "playground",
                    "providers": ["Pollinations"],
                    "model_obj": None,
                },
                "sd-turbo": {
                    "base_provider": "stability-ai",
                    "providers": ["Pollinations", "Prodia"],
                    "model_obj": None,
                },
            }

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
                "https://g4f.dev/api/providers",  # Official g4f.dev endpoint
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

        # Add known providers that might not be in the module but are mentioned in docs
        known_providers = [
            "Pollinations",
            "Prodia",
            "MetaAI",
            "Claude3Haiku",
            "FreeGpt",
            "Chatgpt4Online",
        ]
        for provider_name in known_providers:
            # Check if already in the list
            already_exists = any(
                p.get("name", p.get("id")) == provider_name for p in providers
            )
            if not already_exists:
                providers.append(
                    {
                        "id": provider_name,
                        "name": provider_name,
                        "class": None,  # Not available as a class yet
                        "capabilities": [],
                        "auth_required": False,
                    }
                )

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
        # Handle provider/model format (e.g., "Phind/gpt-4")
        if "/" in provider:
            provider_name = provider.split("/")[0]
        else:
            provider_name = provider

        # Find the provider class by name
        provider_obj = getattr(g4f.Provider, provider_name, None)
        if provider_obj:
            client_kwargs["provider"] = provider_obj
        else:
            # Try to match provider name case-insensitively
            for attr_name in dir(g4f.Provider):
                attr = getattr(g4f.Provider, attr_name)
                if (
                    hasattr(attr, "__name__")
                    and attr.__name__.lower() == provider_name.lower()
                ):
                    client_kwargs["provider"] = attr
                    break

    # Add image provider if specified
    if image_provider:
        # Handle provider/model format for image providers
        if "/" in image_provider:
            image_provider_name = image_provider.split("/")[0]
        else:
            image_provider_name = image_provider

        image_provider_obj = getattr(g4f.Provider, image_provider_name, None)
        if image_provider_obj:
            client_kwargs["image_provider"] = image_provider_obj
        else:
            # Try to match image provider name case-insensitively
            for attr_name in dir(g4f.Provider):
                attr = getattr(g4f.Provider, attr_name)
                if (
                    hasattr(attr, "__name__")
                    and attr.__name__.lower() == image_provider_name.lower()
                ):
                    client_kwargs["image_provider"] = attr
                    break

    # Merge with any additional kwargs provided
    client_kwargs.update(kwargs)

    try:
        # For providers that need special configuration (like Google Bard)
        if provider and (
            "bard" in provider.lower()
            or "gemini" in provider.lower()
            or "google" in provider.lower()
        ):
            # Add headers or cookies if available
            if "headers" not in client_kwargs:
                client_kwargs["headers"] = {}
            # Note: In real implementation, PSID cookies would come from environment or request
            # For now, we'll just log that they might be needed
            logger.info(f"Provider {provider} may require authentication tokens")

        return Client(**client_kwargs)
    except Exception as e:
        logger.warning(
            f"Failed to create client with options: {e}, using default client. Error: {str(e)}"
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

        # Create the completion - respect the stream parameter
        # Handle the case when model is specified in provider/model format
        actual_model = model
        if "/" in model:
            # Extract actual model name if in provider/model format
            actual_model = model.split("/", 1)[1]  # Take part after first slash

        response = custom_client.chat.completions.create(
            model=actual_model,
            messages=messages,
            stream=stream,
            temperature=temperature,
        )

        if stream:
            # Handle streaming response
            def generate():
                try:
                    full_content = ""
                    for chunk in response:
                        if hasattr(chunk.choices[0], "delta") and hasattr(
                            chunk.choices[0].delta, "content"
                        ):
                            content = chunk.choices[0].delta.content
                            if content is not None:
                                full_content += content
                                # Yield SSE (Server-Sent Events) format
                                yield f"data: {json.dumps({'id': f'chatcmpl-{int(time.time())}', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': model or 'gpt-3.5-turbo', 'choices': [{'index': 0, 'delta': {'content': content}, 'finish_reason': None}]})}\n\n"
                    # Send final chunk with finish_reason
                    yield f"data: {json.dumps({'id': f'chatcmpl-{int(time.time())}', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': model or 'gpt-3.5-turbo', 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as e:
                    logger.error(f"Streaming error: {str(e)}")
                    yield f"data: {json.dumps({'id': f'chatcmpl-{int(time.time())}', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': model or 'gpt-3.5-turbo', 'choices': [{'index': 0, 'delta': {'content': ''}, 'finish_reason': 'stop'}]})}\n\n"
                    yield "data: [DONE]\n\n"

            return Response(generate(), mimetype="text/event-stream")
        else:
            # Handle non-streaming response
            if hasattr(response, "__iter__"):
                # If response is iterable (stream-like), get the full content
                full_content = ""
                try:
                    for chunk in response:
                        if hasattr(chunk.choices[0], "delta") and hasattr(
                            chunk.choices[0].delta, "content"
                        ):
                            content = chunk.choices[0].delta.content
                            if content:
                                full_content += content
                        elif hasattr(chunk.choices[0], "message") and hasattr(
                            chunk.choices[0].message, "content"
                        ):
                            content = chunk.choices[0].message.content
                            if content:
                                full_content += content
                except:
                    # Fallback: try to get content directly if it's not streaming
                    content = (
                        response.choices[0].message.content
                        if response.choices
                        and response.choices[0].message
                        and hasattr(response.choices[0].message, "content")
                        else None
                    )
                    full_content = content or ""
            else:
                # Direct response (not streaming)
                content = (
                    response.choices[0].message.content
                    if response.choices
                    and response.choices[0].message
                    and hasattr(response.choices[0].message, "content")
                    else None
                )
                full_content = content or ""

            # Format as OpenAI-compatible response
            result = ChatCompletionResponse.create_response(model, full_content)
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

        # Create the completion - respect the stream parameter
        # Handle the case when model is specified in provider/model format
        actual_model = model
        if "/" in model:
            # Extract actual model name if in provider/model format
            actual_model = model.split("/", 1)[1]  # Take part after first slash

        response = custom_client.chat.completions.create(
            model=actual_model,
            messages=messages,
            stream=stream,
            temperature=temperature,
        )

        if stream:
            # Handle streaming response for completions
            def generate():
                try:
                    full_content = ""
                    for chunk in response:
                        if hasattr(chunk.choices[0], "delta") and hasattr(
                            chunk.choices[0].delta, "content"
                        ):
                            content = chunk.choices[0].delta.content
                            if content is not None:
                                full_content += content
                                # Yield SSE (Server-Sent Events) format for text completion
                                yield f"data: {json.dumps({'id': f'cmpl-{int(time.time())}', 'object': 'text_completion.chunk', 'created': int(time.time()), 'model': model or 'gpt-3.5-turbo', 'choices': [{'index': 0, 'text': content, 'finish_reason': None}]})}\n\n"
                    # Send final chunk with finish_reason
                    yield f"data: {json.dumps({'id': f'cmpl-{int(time.time())}', 'object': 'text_completion.chunk', 'created': int(time.time()), 'model': model or 'gpt-3.5-turbo', 'choices': [{'index': 0, 'text': '', 'finish_reason': 'stop'}]})}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as e:
                    logger.error(f"Streaming error in completions: {str(e)}")
                    yield f"data: {json.dumps({'id': f'cmpl-{int(time.time())}', 'object': 'text_completion.chunk', 'created': int(time.time()), 'model': model or 'gpt-3.5-turbo', 'choices': [{'index': 0, 'text': '', 'finish_reason': 'stop'}]})}\n\n"
                    yield "data: [DONE]\n\n"

            return Response(generate(), mimetype="text/event-stream")
        else:
            # Handle non-streaming response for completions
            if hasattr(response, "__iter__"):
                # If response is iterable (stream-like), get the full content
                full_content = ""
                try:
                    for chunk in response:
                        if hasattr(chunk.choices[0], "delta") and hasattr(
                            chunk.choices[0].delta, "content"
                        ):
                            content = chunk.choices[0].delta.content
                            if content:
                                full_content += content
                        elif hasattr(chunk.choices[0], "message") and hasattr(
                            chunk.choices[0].message, "content"
                        ):
                            content = chunk.choices[0].message.content
                            if content:
                                full_content += content
                except:
                    # Fallback: try to get content directly if it's not streaming
                    content = (
                        response.choices[0].message.content
                        if response.choices
                        and response.choices[0].message
                        and hasattr(response.choices[0].message, "content")
                        else None
                    )
                    full_content = content or ""
            else:
                # Direct response (not streaming)
                content = (
                    response.choices[0].message.content
                    if response.choices
                    and response.choices[0].message
                    and hasattr(response.choices[0].message, "content")
                    else None
                )
                full_content = content or ""

            # Format as OpenAI-compatible response
            result = {
                "id": f"cmpl-{int(time.time())}",
                "object": "text_completion",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "text": full_content,
                        "logprobs": None,
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": len(prompt.split()),
                    "completion_tokens": len(full_content.split()),
                    "total_tokens": len(prompt.split()) + len(full_content.split()),
                },
            }

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

        # Format models in OpenAI style, including provider-specific formats
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

            # Add the base model
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

            # Also add provider-specific model formats (provider/model)
            providers = model_info.get("providers", [])
            for provider in providers:
                if provider:  # Only add if provider is not empty
                    provider_model_id = (
                        f"{provider}/{model_id}" if provider != "unknown" else model_id
                    )
                    if provider_model_id != str(model_id):  # Avoid duplicates
                        available_models.append(
                            {
                                "id": provider_model_id,
                                "object": "model",
                                "created": 1677610602,
                                "owned_by": str(provider).lower()
                                if provider != "unknown"
                                else str(owned_by),
                                "providers": [provider],
                                "base_model": str(model_id),
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
            {
                "id": "dall-e-2",
                "object": "model",
                "created": 1677610602,
                "owned_by": "openai",
            },
            {
                "id": "dall-e-3",
                "object": "model",
                "created": 1677610602,
                "owned_by": "openai",
            },
            {
                "id": "flux",
                "object": "model",
                "created": 1677610602,
                "owned_by": "blackforestlabs",
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

        # Handle the case when model is specified in provider/model format for image generation
        actual_model = model
        if "/" in model:
            # Extract actual model name if in provider/model format
            actual_model = model.split("/", 1)[1]  # Take part after first slash

        # Generate image using G4F
        response = custom_client.images.generate(
            model=actual_model, prompt=prompt, response_format=response_format
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
