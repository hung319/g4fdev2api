/**
 * Bun AI Gateway v4.5 (Global Debug Edition)
 * - Feature: Global Logger (Log mọi request đến server).
 * - Feature: Log IP Client (để debug Docker network).
 * - Routing: Chấp nhận cả URL có/không có dấu gạch chéo cuối (trailing slash).
 */

const API_KEY = process.env.API_KEY || '1'; 
const PORT = process.env.PORT || 3000;

// =================================================================================
// 🛡️ Headers
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
// ⚙️ Config
// =================================================================================
const PROVIDER_CONFIG = {
  'worker': {
    name: 'Worker',
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
  'airforce': { 
    name: 'Airforce',
    upstreamHost: 'api.airforce',
    modelsPath: '/v1/models', 
    chatPath: '/v1/chat/completions',
    imagePath: '/v1/images/generations'
  },
  // ... Các provider khác tương tự
};

// =================================================================================
// 🧠 Model Map
// =================================================================================
let MODEL_PROVIDER_MAP = null;

async function buildModelProviderMap() {
  console.log("🚀 [System] Đang build map...");
  const map = new Map();

  const fetchPromises = Object.entries(PROVIDER_CONFIG).map(async ([providerKey, config]) => {
    try {
      let models = [];
      if (config.modelsPath) {
        const upstreamUrl = `https://${config.upstreamHost}${config.modelsPath}`;
        const response = await fetch(upstreamUrl, { method: 'GET', headers: COMMON_HEADERS });
        if (response.ok) {
            const data = await response.json();
            if (data.success && Array.isArray(data.result)) {
                models = data.result.map(m => m.name).filter(Boolean);
            } else if (Array.isArray(data)) {
                models = data.map(m => m.id || m.name).filter(Boolean);
            } else if (data.data && Array.isArray(data.data)) {
                models = data.data.map(m => m.id).filter(Boolean);
            } else if (data.models && Array.isArray(data.models)) {
                models = data.models.map(m => m.name).filter(Boolean);
            }
        }
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
    } catch (e) {}
  });

  await Promise.allSettled(fetchPromises);
  MODEL_PROVIDER_MAP = map;
  console.log(`✅ [System] Ready. Total: ${MODEL_PROVIDER_MAP.size}`);
}

// =================================================================================
// 🔌 Handlers
// =================================================================================

async function handleChatCompletionRequest(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) return new Response('Unauthorized', { status: 401 });

  try {
      const requestBody = await req.json();
      const incomingModelId = requestBody.model; 
      const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);
      if (!providerInfo) return new Response(JSON.stringify({error: `Model not found`}), { status: 404 });

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
    console.log(`📸 [LOGIC] Vào hàm xử lý ảnh...`);
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        console.log(`📸 [LOGIC] Sai API Key!`);
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const requestBody = await req.json();
        const incomingModelId = requestBody.model; 
        console.log(`📸 [LOGIC] Model: ${incomingModelId}`);

        if (!incomingModelId) return new Response(JSON.stringify({error: 'Missing model'}), { status: 400 });

        const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);
        if (!providerInfo || !providerInfo.imagePath) {
             console.log(`📸 [LOGIC] Model/Provider không hợp lệ.`);
             return new Response(JSON.stringify({error: `Model invalid or no image support.`}), { status: 404 });
        }

        const upstreamUrl = `https://${providerInfo.upstreamHost}${providerInfo.imagePath}`;
        console.log(`📸 [LOGIC] Calling Upstream: ${upstreamUrl}`);

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

        console.log(`📸 [LOGIC] Upstream Status: ${upstreamResponse.status}`);
        
        if (!upstreamResponse.ok) {
            const errText = await upstreamResponse.text();
            console.log(`📸 [LOGIC] ERROR BODY: ${errText.substring(0, 200)}...`);
            return new Response(errText, { status: upstreamResponse.status });
        }

        return new Response(upstreamResponse.body, {
            status: 200,
            headers: {
                'Content-Type': upstreamResponse.headers.get('Content-Type') || 'image/jpeg',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            }
        });

    } catch (error) {
        console.error(`📸 [LOGIC] Exception: ${error.message}`);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

// =================================================================================
// 🚀 Server Entry (Với Global Logging)
// =================================================================================

console.log(`🚀 Starting Bun AI Gateway v4.5 on port ${PORT}...`);
buildModelProviderMap();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    
    // 🔥 GLOBAL LOG: In ra mọi request đập vào server
    console.log(`🔔 [INCOMING] ${req.method} ${url.pathname}`);

    // CORS Preflight
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

    // 🛡️ Routing Logic (Bỏ trailing slash để an toàn)
    const path = url.pathname.replace(/\/$/, ''); 

    if (path === '/v1/models') return handleModelsRequest();
    if (path === '/v1/chat/completions') return handleChatCompletionRequest(req);
    if (path === '/v1/images/generations') return handleImageGenerationRequest(req);
    
    // Nếu không khớp route nào:
    console.log(`⚠️ [404] Route không khớp: ${path}`);
    return new Response(JSON.stringify({status: 'online', path: path}), { 
        status: 404, 
        headers: {'Content-Type': 'application/json'}
    });
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
