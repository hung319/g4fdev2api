"""
G4F OpenAI-Compatible API Server

This script creates an API server that mimics the OpenAI API structure
but uses G4F (GPT4Free) as the backend provider. It's designed to be
drop-in compatible with existing OpenAI integrations.
"""

from flask import Flask, request, jsonify, Response
from g4f.client import Client
import os
import logging
import json
import time
from typing import Optional, Dict, Any

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize G4F client
client = Client()

# Store for conversation histories (in production, use a proper DB)
conversations = {}

class ChatCompletionResponse:
    """Helper class to format chat completion responses in OpenAI format"""
    
    @staticmethod
    def create_response(model: str, content: str, conversation_id: str = None) -> Dict[str, Any]:
        response_id = f"chatcmpl-{int(time.time())}"
        return {
            "id": response_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": len(content.split()),  # Approximate
                "completion_tokens": len(content.split()),  # Approximate
                "total_tokens": len(content.split()) * 2  # Approximate
            }
        }

@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    """Handle chat completions in OpenAI API format"""
    try:
        data = request.get_json()
        
        # Extract parameters
        model = data.get("model", "gpt-3.5-turbo")
        messages = data.get("messages", [])
        stream = data.get("stream", False)
        temperature = data.get("temperature", 0.7)
        max_tokens = data.get("max_tokens", None)
        
        # Prepare messages for G4F client
        # Note: G4F expects a different format than OpenAI, but the client handles conversion
        
        # Create the completion
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=False,  # For now, we'll handle streaming separately if needed
            temperature=temperature
        )
        
        content = response.choices[0].message.content
        
        # Format as OpenAI-compatible response
        result = ChatCompletionResponse.create_response(model, content)
        
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
        return jsonify({
            "error": {
                "type": "invalid_request_error",
                "message": str(e)
            }
        }), 400


@app.route("/v1/completions", methods=["POST"])
def completions():
    """Handle text completions (non-chat) in OpenAI API format"""
    try:
        data = request.get_json()
        
        # Extract parameters
        model = data.get("model", "gpt-3.5-turbo")
        prompt = data.get("prompt", "")
        stream = data.get("stream", False)
        temperature = data.get("temperature", 0.7)
        max_tokens = data.get("max_tokens", 256)
        
        # Convert prompt to messages format for G4F
        messages = [{"role": "user", "content": prompt}]
        
        # Create the completion
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=False,
            temperature=temperature
        )
        
        content = response.choices[0].message.content
        
        # Format as OpenAI-compatible response
        result = {
            "id": f"cmpl-{int(time.time())}",
            "object": "text_completion",
            "created": int(time.time()),
            "model": model,
            "choices": [{
                "index": 0,
                "text": content,
                "logprobs": None,
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": len(prompt.split()),
                "completion_tokens": len(content.split()),
                "total_tokens": len(prompt.split()) + len(content.split())
            }
        }
        
        if stream:
            def generate():
                yield json.dumps(result)
            
            return Response(generate(), mimetype="application/json")
        else:
            return jsonify(result)
            
    except Exception as e:
        logger.error(f"Error in completions: {str(e)}")
        return jsonify({
            "error": {
                "type": "invalid_request_error",
                "message": str(e)
            }
        }), 400


@app.route("/v1/models", methods=["GET"])
def list_models():
    """List available models (placeholder - expand as needed)"""
    # In a real implementation, we'd fetch actual models from G4F
    models = [
        {
            "id": "gpt-3.5-turbo",
            "object": "model",
            "created": 1677610602,
            "owned_by": "g4f"
        },
        {
            "id": "gpt-4",
            "object": "model",
            "created": 1677610602,
            "owned_by": "g4f"
        },
        {
            "id": "gpt-4o",
            "object": "model",
            "created": 1677610602,
            "owned_by": "g4f"
        },
        {
            "id": "gpt-4o-mini",
            "object": "model",
            "created": 1677610602,
            "owned_by": "g4f"
        },
        {
            "id": "claude-3-haiku",
            "object": "model",
            "created": 1677610602,
            "owned_by": "g4f"
        },
        {
            "id": "llama-3.1-70b",
            "object": "model",
            "created": 1677610602,
            "owned_by": "g4f"
        }
    ]
    
    return jsonify({
        "object": "list",
        "data": models
    })


@app.route("/v1/images/generations", methods=["POST"])
def images_generations():
    """Handle image generation in OpenAI API format"""
    try:
        data = request.get_json()
        
        prompt = data.get("prompt", "")
        model = data.get("model", "dalle-3")
        n = data.get("n", 1)
        size = data.get("size", "1024x1024")
        response_format = data.get("response_format", "url")
        
        # Generate image using G4F
        response = client.images.generate(
            model=model,
            prompt=prompt,
            response_format=response_format
        )
        
        # Convert to OpenAI format
        image_data = []
        for img in response.data:
            if hasattr(img, 'url'):
                image_data.append({
                    "url": img.url
                })
            elif hasattr(img, 'b64_json'):
                image_data.append({
                    "b64_json": img.b64_json
                })
        
        result = {
            "created": int(time.time()),
            "data": image_data
        }
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error in images_generations: {str(e)}")
        return jsonify({
            "error": {
                "type": "invalid_request_error",
                "message": str(e)
            }
        }), 400


@app.route("/", methods=["GET"])
def health_check():
    """Basic health check"""
    return jsonify({
        "status": "ok",
        "service": "G4F OpenAI-Compatible API",
        "version": "1.0.0"
    })


@app.errorhandler(404)
def not_found(error):
    return jsonify({
        "error": {
            "type": "not_found_error",
            "message": "The requested resource was not found"
        }
    }), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        "error": {
            "type": "server_error",
            "message": "An internal server error occurred"
        }
    }), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    
    logger.info(f"Starting G4F OpenAI-Compatible API server on {host}:{port}")
    app.run(host=host, port=port, debug=debug)