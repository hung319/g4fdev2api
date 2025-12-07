/**
 * Bun AI Gateway v4.4 (Stable & Secured)
 * - Fix: Ngăn chặn Race Condition khi fetch models (Loop Fix).
 * - Security: Random Fake IP injection per request.
 * - Logic: Optimized Parser & Headers.
 */

const API_KEY = process.env.API_KEY || '1'; 
const PORT = process.env.PORT || 3000;

// =================================================================================
// 🛡️ 0. Utilities & Security (Fake IP)
// =================================================================================

// Hàm tạo IP ngẫu nhiên để tránh bị chặn IP từ phía upstream
function getRandomIP() {
    const segment = () => Math.floor(Math.random() * 255);
    return `103.${segment()}.${segment()}.${segment()}`;
}

// Base Headers giả lập Browser
const BASE_HEADERS = {
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

// Hàm lấy headers (Merge Base + Dynamic IP)
function getHeaders() {
    const fakeIp = getRandomIP();
    return {
        ...BASE_HEADERS,
        'X-Forwarded-For': fakeIp,
        'X-Real-IP': fakeIp,
        'True-Client-IP': fakeIp
    };
}

// =================================================================================
// ⚙️ 1. Cấu hình Providers
// =================================================================================

const PROVIDER_CONFIG = {
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
// 🧠 2. Core Logic: Model Map Builder (Fixed Loop Issue)
// =================================================================================

// Khởi tạo Map rỗng ngay lập tức để tránh check null liên tục
let MODEL_PROVIDER_MAP = new Map();
let isFetchingModels = false; // 🔒 Lock flag

async function buildModelProviderMap() {
  if (isFetchingModels) {
      console.log("⚠️ Đang cập nhật models, bỏ qua yêu cầu trùng lặp.");
      return;
  }
  
  isFetchingModels = true;
  console.log("🚀 Bắt đầu cập nhật danh sách models...");
  
  const map = new Map();

  const fetchPromises = Object.entries(PROVIDER_CONFIG).map(async ([providerKey, config]) => {
    try {
      let models = [];
      if (config.modelsPath) {
        const upstreamUrl = `https://${config.upstreamHost}${config.modelsPath}`;
        // Sử dụng dynamic headers cho request này
        const response = await fetch(upstreamUrl, { method: 'GET', headers: getHeaders() });
        
        if (response.ok) {
            const data = await response.json();
            
            // --- PARSING LOGIC ---
            if (data.success && Array.isArray(data.result)) {
                models = data.result.map(m => m.name).filter(Boolean);
            } 
            else if (Array.isArray(data)) {
                models = data.map(m => m.id || m.name).filter(Boolean);
            } 
            else if (data.data && Array.isArray(data.data)) {
                models = data.data.map(m => m.id).filter(Boolean);
            } 
            else if (data.models && Array.isArray(data.models)) {
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

    } catch (error) {
      console.error(`  -> [${providerKey}] Error: ${error.message}`);
    }
  });

  await Promise.allSettled(fetchPromises);
  
  // Chỉ cập nhật map global khi có dữ liệu (hoặc giữ cũ nếu lỗi toàn bộ)
  if (map.size > 0) {
      MODEL_PROVIDER_MAP = map;
      console.log(`✅ Cập nhật hoàn tất. Tổng model khả dụng: ${MODEL_PROVIDER_MAP.size}`);
  } else {
      console.log("⚠️ Không lấy được model nào, giữ nguyên cache cũ.");
  }
  
  isFetchingModels = false; // 🔓 Unlock
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
      if (!providerInfo) return new Response(`Model '${incomingModelId}' not found (Try refreshing).`, { status: 404 });

      const upstreamUrl = `https://${providerInfo.upstreamHost}${providerInfo.chatPath}`;
      const upstreamBody = { ...requestBody, model: providerInfo.targetModelId };

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: getHeaders(), // ✅ Inject Fake IP Headers
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
            headers: getHeaders(), // ✅ Inject Fake IP Headers
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

console.log(`🚀 Starting Bun AI Gateway v4.4 on port ${PORT}...`);

// Chạy lần đầu (Non-blocking hoặc Blocking tuỳ logic, ở đây để non-blocking nhưng gọi ngay)
buildModelProviderMap();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS pre-flight
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        });
    }

    // Tự động retry build model map nếu map rỗng (nhưng có lock isFetchingModels để tránh spam)
    if (MODEL_PROVIDER_MAP.size === 0 && !isFetchingModels) {
        // Build background, không await để tránh timeout request hiện tại (hoặc await nếu muốn chắc chắn)
        buildModelProviderMap(); 
    }

    if (url.pathname === '/v1/models') return handleModelsRequest();
    if (url.pathname === '/v1/chat/completions') return handleChatCompletionRequest(req);
    if (url.pathname === '/v1/images/generations') return handleImageGenerationRequest(req);
    
    if (url.pathname === '/') {
        return new Response(JSON.stringify({ 
            status: 'ok', 
            service: 'Bun AI Gateway v4.4',
            models_count: MODEL_PROVIDER_MAP.size 
        }), { headers: { 'Content-Type': 'application/json' }});
    }

    return new Response('Not Found', { status: 404 });
  },
});

function handleModelsRequest() {
  const modelsData = Array.from(MODEL_PROVIDER_MAP.entries()).map(([id, info]) => ({
    id: id,
    object: 'model',
    owned_by: info.providerId,
  }));
  return new Response(JSON.stringify({ object: 'list', data: modelsData }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
