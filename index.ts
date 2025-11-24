/**
 * Bun AI Gateway v3.1
 * - Update: Hỗ trợ dynamic models cho api.airforce
 * - Fix: Cập nhật Headers giả lập browser mạnh hơn
 */

// =================================================================================
// ⚙️ 1. Cấu hình & Biến môi trường
// =================================================================================

const API_KEY = process.env.API_KEY || 'default-secret-key';
const PORT = process.env.PORT || 3000;

// Cấu hình Upstream Providers
const PROVIDER_CONFIG = {
  'api.airforce': {
    name: 'Airforce API',
    upstreamHost: 'api.airforce',
    modelsPath: '/v1/models', // ✅ Chuyển sang động
    chatPath: '/v1/chat/completions'
  },
  'anondrop.net': {
    name: 'AnonDrop',
    upstreamHost: 'anondrop.net',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions'
  },
  'gpt4free.pro': {
    name: 'GPT4Free.pro',
    upstreamHost: 'gpt4free.pro',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions'
  },
  'gemini': {
    name: 'Google Gemini (via g4f)',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/gemini/models',
    chatPath: '/api/gemini/chat/completions'
  },
  'grok': {
    name: 'Grok (via g4f)',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/grok/models',
    chatPath: '/api/grok/chat/completions'
  },
  'pollinations.ai': {
    name: 'Pollinations.ai (via g4f)',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/pollinations.ai/models',
    chatPath: '/api/pollinations.ai/chat/completions'
  },
  'ollama': {
    name: 'Ollama (via g4f)',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/ollama/models',
    chatPath: '/api/ollama/chat/completions'
  },
  'huggingface': {
    name: 'HuggingFace (via g4f)',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/huggingface/models?inference=warm&&expand[]=inferenceProviderMapping',
    chatPath: '/api/huggingface/chat/completions'
  }
};

// =================================================================================
// 🧠 2. Core Logic: Model Map Builder
// =================================================================================

let MODEL_PROVIDER_MAP = null;

async function buildModelProviderMap() {
  console.log("🚀 Đang xây dựng danh mục models...");
  const map = new Map();

  const fetchPromises = Object.entries(PROVIDER_CONFIG).map(async ([providerId, config]) => {
    try {
      // 1. Xử lý model hardcode (nếu còn)
      if (config.models && !config.modelsPath) {
        config.models.forEach(modelId => {
          map.set(modelId, { providerId, upstreamHost: config.upstreamHost, chatPath: config.chatPath });
        });
        return;
      }

      // 2. Xử lý model động (fetch từ upstream)
      if (config.modelsPath) {
        const upstreamUrl = `https://${config.upstreamHost}${config.modelsPath}`;
        
        // Headers mạnh hơn, copy từ curl request thực tế để bypass firewall
        const headers = {
            'accept': '*/*',
            'accept-language': 'vi-VN,vi;q=0.9',
            'content-type': 'application/json',
            'origin': 'https://g4f.dev',
            'referer': 'https://g4f.dev/',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
            'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'cross-site'
        };

        const response = await fetch(upstreamUrl, {
          method: 'GET',
          headers: headers
        });
        
        if (!response.ok) {
          console.warn(`⚠️ Provider '${providerId}' trả về lỗi: ${response.status}`);
          return; 
        }
        
        const data = await response.json();
        let models = [];

        // Parsing logic thông minh
        if (Array.isArray(data)) {
            models = data.map(m => m.id || m.name).filter(Boolean);
        } else if (data.data && Array.isArray(data.data)) {
            // Logic này sẽ khớp với Airforce (data.data[].id)
            models = data.data.map(m => m.id).filter(Boolean);
        } else if (data.models && Array.isArray(data.models)) {
            models = data.models.map(m => m.name).filter(Boolean);
        }
       
        models.forEach(modelId => {
          // Chỉ add nếu chưa tồn tại hoặc ghi đè tùy chiến lược (ở đây là ghi đè)
          map.set(modelId, { providerId, upstreamHost: config.upstreamHost, chatPath: config.chatPath });
        });
        console.log(`  -> ${providerId}: Đã tải ${models.length} models.`);
      }
    } catch (error) {
      console.error(`❌ Lỗi fetch provider '${providerId}': ${error.message}`);
    }
  });

  await Promise.allSettled(fetchPromises);
  MODEL_PROVIDER_MAP = map;
  console.log(`✅ Đã xây dựng xong map. Tổng số model unique: ${MODEL_PROVIDER_MAP.size}`);
}

// =================================================================================
// 🔌 3. Request Handlers
// =================================================================================

async function handleChatCompletionRequest(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized', message: 'Invalid API Key' }), { 
        status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
      const requestBody = await req.json();
      const modelId = requestBody.model;

      if (!modelId) {
        return new Response(JSON.stringify({ error: 'Bad Request', message: 'Missing "model" field' }), { status: 400 });
      }

      const providerInfo = MODEL_PROVIDER_MAP.get(modelId);

      if (!providerInfo) {
        return new Response(JSON.stringify({ 
            error: 'Model Not Found', 
            message: `Model '${modelId}' không khả dụng. Kiểm tra danh sách tại /v1/models` 
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      const { upstreamHost, chatPath } = providerInfo;
      const upstreamUrl = `https://${upstreamHost}${chatPath}`;

      // Headers cho Chat Request (Dùng chung bộ giả lập browser)
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', '*/*');
      headers.set('Origin', 'https://g4f.dev');
      headers.set('Referer', 'https://g4f.dev/');
      headers.set('User-Agent', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36');

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        redirect: 'follow'
      });

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: {
          'Content-Type': upstreamResponse.headers.get('Content-Type') || 'text/event-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        }
      });

  } catch (error) {
      return new Response(JSON.stringify({ error: 'Internal Error', message: error.message }), { status: 500 });
  }
}

function handleModelsRequest() {
  if (!MODEL_PROVIDER_MAP) {
    return new Response(JSON.stringify({ error: 'Service Unavailable', message: 'Models loading...' }), { status: 503 });
  }

  const modelsData = Array.from(MODEL_PROVIDER_MAP.entries()).map(([id, { providerId }]) => ({
    id,
    object: 'model',
    owned_by: providerId,
  }));

  return new Response(JSON.stringify({ object: 'list', data: modelsData }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// =================================================================================
// 🚀 4. Bun Server Entry Point
// =================================================================================

console.log(`🚀 Starting Bun AI Gateway on port ${PORT}...`);
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

    if (MODEL_PROVIDER_MAP === null) {
      await buildModelProviderMap();
    }

    if (url.pathname === '/v1/models') return handleModelsRequest();
    if (url.pathname === '/v1/chat/completions') return handleChatCompletionRequest(req);
    
    if (url.pathname === '/') {
        return new Response(JSON.stringify({ 
            status: 'ok', 
            service: 'Bun AI Gateway v3.1', 
            models_count: MODEL_PROVIDER_MAP ? MODEL_PROVIDER_MAP.size : 0 
        }), { headers: { 'Content-Type': 'application/json' }});
    }

    return new Response('Not Found', { status: 404 });
  },
});
