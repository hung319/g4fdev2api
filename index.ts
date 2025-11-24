/**
 * Bun AI Gateway v4.3 (Worker Dynamic Fixed)
 * - Logic: Cập nhật parser để đọc cấu trúc JSON { success: true, result: [...] } của Worker.
 * - Result: Tự động load ~30+ models từ Worker (DeepSeek, Llama 3, Flux, etc.).
 * - Headers: Optimized based on latest user curl.
 */

const API_KEY = process.env.API_KEY || '1'; 
const PORT = process.env.PORT || 3000;

// =================================================================================
// 🛡️ 0. Headers Giả lập (Strictly matched)
// =================================================================================
const COMMON_HEADERS = {
    'accept': '*/*',
    'accept-language': 'vi-VN,vi;q=0.9',
    'content-type': 'application/json',
    'origin': 'https://g4f.dev',
    'referer': 'https://g4f.dev/chat/pro.html', 
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
};

// =================================================================================
// ⚙️ 1. Cấu hình Providers
// =================================================================================

const PROVIDER_CONFIG = {
  // ✅ 1. Worker (Dynamic fetch enabled)
  'worker': {
    name: 'Worker (Cloudflare)',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/worker/models',
    chatPath: '/api/worker/chat/completions',
    imagePath: '/api/worker/images/generations' 
  },
  'openrouter': {
    name: 'OpenRouter',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/openrouter/models',
    chatPath: '/api/openrouter/chat/completions',
    imagePath: '/api/openrouter/images/generations'
  },
  'azure': {
    name: 'Azure',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/azure/models',
    chatPath: '/api/azure/chat/completions',
    imagePath: '/api/azure/images/generations'
  },
  'airforce': { 
    name: 'Airforce',
    upstreamHost: 'api.airforce',
    modelsPath: '/v1/models', 
    chatPath: '/v1/chat/completions',
    imagePath: '/v1/images/generations'
  },
  'gpt4free': {
    name: 'GPT4Free',
    upstreamHost: 'gpt4free.pro',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions',
    imagePath: '/v1/images/generations'
  },
  'anondrop': {
    name: 'AnonDrop',
    upstreamHost: 'anondrop.net',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions',
    imagePath: '/v1/images/generations'
  },
  'gemini': {
    name: 'Gemini',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/gemini/models',
    chatPath: '/api/gemini/chat/completions',
    imagePath: '/api/gemini/images/generations'
  },
  'grok': {
    name: 'Grok',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/grok/models',
    chatPath: '/api/grok/chat/completions',
    imagePath: '/api/grok/images/generations'
  },
  'pollinations': {
    name: 'Pollinations',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/pollinations.ai/models',
    chatPath: '/api/pollinations.ai/chat/completions',
    imagePath: '/api/pollinations.ai/images/generations'
  },
  'ollama': {
    name: 'Ollama',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/ollama/models',
    chatPath: '/api/ollama/chat/completions',
    imagePath: '/api/ollama/images/generations'
  }
};

// =================================================================================
// 🧠 2. Core Logic: Model Map Builder (Updated Parser)
// =================================================================================

let MODEL_PROVIDER_MAP = null;

async function buildModelProviderMap() {
  console.log("🚀 Đang cập nhật danh sách models...");
  const map = new Map();

  const fetchPromises = Object.entries(PROVIDER_CONFIG).map(async ([providerKey, config]) => {
    try {
      let models = [];
      if (config.modelsPath) {
        const upstreamUrl = `https://${config.upstreamHost}${config.modelsPath}`;
        const response = await fetch(upstreamUrl, { method: 'GET', headers: COMMON_HEADERS });
        
        if (response.ok) {
            const data = await response.json();
            
            // --- PARSING LOGIC CẬP NHẬT ---
            if (data.success && Array.isArray(data.result)) {
                // ✅ Case: Worker (g4f) trả về { success: true, result: [{name: ...}] }
                models = data.result.map(m => m.name).filter(Boolean);
            } 
            else if (Array.isArray(data)) {
                // Case: HuggingFace/Pollinations ([...])
                models = data.map(m => m.id || m.name).filter(Boolean);
            } 
            else if (data.data && Array.isArray(data.data)) {
                // Case: OpenAI Standard / Azure ({ data: [...] })
                models = data.data.map(m => m.id).filter(Boolean);
            } 
            else if (data.models && Array.isArray(data.models)) {
                // Case: Ollama ({ models: [...] })
                models = data.models.map(m => m.name).filter(Boolean);
            }
        }
      }

      // Xử lý Fallback nếu cần (nhưng với Worker fix trên thì không cần nữa)
      if (models.length === 0 && config.fallbackModels) {
          models = config.fallbackModels;
      }

      models.forEach(originalModelId => {
        const namespacedId = `${providerKey}/${originalModelId}`;
        map.set(namespacedId, { 
            providerId: providerKey, 
            upstreamHost: config.upstreamHost, 
            chatPath: config.chatPath,
            imagePath: config.imagePath,
            targetModelId: originalModelId 
        });
      });
      
      if (models.length > 0) console.log(`  -> [${providerKey}] OK: ${models.length} models`);

    } catch (error) {
      console.error(`  -> [${providerKey}] Error: ${error.message}`);
    }
  });

  await Promise.allSettled(fetchPromises);
  MODEL_PROVIDER_MAP = map;
  console.log(`✅ Hoàn tất. Tổng model khả dụng: ${MODEL_PROVIDER_MAP.size}`);
}

// =================================================================================
// 🔌 3. Request Handlers
// =================================================================================

async function handleChatCompletionRequest(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) return new Response('Unauthorized', { status: 401 });

  try {
      const requestBody = await req.json();
      const incomingModelId = requestBody.model; 
      if (!incomingModelId) return new Response('Missing model', { status: 400 });

      const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);
      if (!providerInfo) return new Response(`Model '${incomingModelId}' not found.`, { status: 404 });

      const upstreamUrl = `https://${providerInfo.upstreamHost}${providerInfo.chatPath}`;
      const upstreamBody = { ...requestBody, model: providerInfo.targetModelId };

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: COMMON_HEADERS,
        body: JSON.stringify(upstreamBody),
        redirect: 'follow'
      });

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': upstreamResponse.headers.get('Content-Type') || 'text/event-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        }
      });
  } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

async function handleImageGenerationRequest(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) return new Response('Unauthorized', { status: 401 });

    try {
        const requestBody = await req.json();
        const incomingModelId = requestBody.model; 
        if (!incomingModelId) return new Response('Missing model', { status: 400 });

        const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);
        if (!providerInfo || !providerInfo.imagePath) {
             return new Response(`Model '${incomingModelId}' not support image gen.`, { status: 404 });
        }

        const upstreamUrl = `https://${providerInfo.upstreamHost}${providerInfo.imagePath}`;
        const upstreamBody = { 
            model: providerInfo.targetModelId, 
            prompt: requestBody.prompt,
            response_format: requestBody.response_format 
        };

        const upstreamResponse = await fetch(upstreamUrl, {
            method: 'POST',
            headers: COMMON_HEADERS,
            body: JSON.stringify(upstreamBody)
        });

        return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            headers: {
                'Content-Type': upstreamResponse.headers.get('Content-Type') || 'image/jpeg',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

// =================================================================================
// 🚀 4. Server Entry
// =================================================================================

console.log(`🚀 Starting Bun AI Gateway v4.3 on port ${PORT}...`);
buildModelProviderMap();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        });
    }

    if (MODEL_PROVIDER_MAP === null) await buildModelProviderMap();

    if (url.pathname === '/v1/models') return handleModelsRequest();
    if (url.pathname === '/v1/chat/completions') return handleChatCompletionRequest(req);
    if (url.pathname === '/v1/images/generations') return handleImageGenerationRequest(req);
    
    if (url.pathname === '/') {
        return new Response(JSON.stringify({ 
            status: 'ok', 
            service: 'Bun AI Gateway v4.3',
            models_count: MODEL_PROVIDER_MAP ? MODEL_PROVIDER_MAP.size : 0 
        }), { headers: { 'Content-Type': 'application/json' }});
    }

    return new Response('Not Found', { status: 404 });
  },
});

function handleModelsRequest() {
  if (!MODEL_PROVIDER_MAP) return new Response('{}', { status: 503 });
  const modelsData = Array.from(MODEL_PROVIDER_MAP.entries()).map(([id, info]) => ({
    id: id,
    object: 'model',
    owned_by: info.providerId,
  }));
  return new Response(JSON.stringify({ object: 'list', data: modelsData }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
