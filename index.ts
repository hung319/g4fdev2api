/**
 * Bun AI Gateway v4.6 (n8n Payload Fix)
 * - Fix Critical: Chỉ gửi đúng 'model' và 'prompt' tới Upstream (tránh lỗi 400 do thừa param).
 * - Debug: Log RAW BODY nhận được từ n8n để kiểm tra JSON.
 * - Error Handling: Nếu Upstream lỗi, trả về Plain Text để n8n hiển thị được (thay vì no body).
 */

const API_KEY = process.env.API_KEY || '1'; 
const PORT = process.env.PORT || 3000;

// =================================================================================
// 🛡️ Headers (Chuẩn Curl)
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
  }
};

// =================================================================================
// 🧠 Model Map
// =================================================================================
let MODEL_PROVIDER_MAP = null;

async function buildModelProviderMap() {
  console.log("🚀 [System] Building Model Map...");
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
  // (Giữ nguyên logic chat cũ)
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

// 🔥 FIX CHÍNH Ở ĐÂY
async function handleImageGenerationRequest(req) {
    console.log(`\n📸 [IMAGE] Request Received`);
    
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        console.log(`📸 [IMAGE] Auth Failed`);
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        // 1. Đọc Raw Text trước để debug xem n8n gửi cái gì
        const rawBody = await req.text();
        console.log(`📸 [IMAGE] Raw Body from n8n:`, rawBody);

        if (!rawBody) {
             return new Response('Empty Body', { status: 400 });
        }

        const requestBody = JSON.parse(rawBody);
        const incomingModelId = requestBody.model; 
        const prompt = requestBody.prompt;

        if (!incomingModelId) return new Response('Missing model field', { status: 400 });
        if (!prompt) return new Response('Missing prompt field', { status: 400 });

        const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);
        if (!providerInfo || !providerInfo.imagePath) {
             console.log(`📸 [IMAGE] Invalid Model: ${incomingModelId}`);
             return new Response(`Model '${incomingModelId}' not supported.`, { status: 404 });
        }

        const upstreamUrl = `https://${providerInfo.upstreamHost}${providerInfo.imagePath}`;
        
        // 2. CLEAN PAYLOAD: Chỉ lấy đúng 2 trường cần thiết
        // Loại bỏ response_format, size, n... nếu chúng là null/undefined
        // Điều này giúp payload giống hệt curl
        const upstreamBody = { 
            model: providerInfo.targetModelId, 
            prompt: prompt
        };

        console.log(`📸 [IMAGE] Upstream URL: ${upstreamUrl}`);
        console.log(`📸 [IMAGE] Upstream Body:`, JSON.stringify(upstreamBody));

        const upstreamResponse = await fetch(upstreamUrl, {
            method: 'POST',
            headers: COMMON_HEADERS,
            body: JSON.stringify(upstreamBody)
        });

        console.log(`📸 [IMAGE] Status: ${upstreamResponse.status}`);
        const contentType = upstreamResponse.headers.get('Content-Type');
        console.log(`📸 [IMAGE] Content-Type: ${contentType}`);

        // 3. Xử lý lỗi Upstream (Đọc text lỗi trả về cho n8n xem)
        if (!upstreamResponse.ok) {
            const errorText = await upstreamResponse.text();
            console.error(`📸 [IMAGE] Error from Upstream: ${errorText}`);
            // Trả về text/plain để n8n không bị lỗi "Bad request no body"
            return new Response(`Upstream Error (${upstreamResponse.status}): ${errorText}`, { 
                status: upstreamResponse.status,
                headers: { 'Content-Type': 'text/plain' }
            });
        }

        // 4. Thành công -> Stream
        return new Response(upstreamResponse.body, {
            status: 200,
            headers: {
                'Content-Type': contentType || 'image/jpeg',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache',
                // Quan trọng cho n8n
                'Content-Disposition': 'attachment; filename="image.jpg"' 
            }
        });

    } catch (error) {
        console.error(`📸 [IMAGE] Exception: ${error.message}`);
        return new Response(`Server Error: ${error.message}`, { status: 500 });
    }
}

// =================================================================================
// 🚀 Server Entry
// =================================================================================

console.log(`🚀 Starting Bun AI Gateway v4.6 on port ${PORT}...`);
buildModelProviderMap();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    
    // CORS
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

    const path = url.pathname.replace(/\/$/, ''); 

    if (path === '/v1/models') return handleModelsRequest();
    if (path === '/v1/chat/completions') return handleChatCompletionRequest(req);
    if (path === '/v1/images/generations') return handleImageGenerationRequest(req);
    
    // 404 Logging
    console.log(`⚠️ 404: ${path}`);
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
