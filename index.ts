/**
 * Bun AI Gateway v3.0 (Ported from Cloudflare Worker)
 *
 * Chức năng:
 * 1. API Gateway thông minh tự động cấu hình.
 * 2. Routing động dựa trên model name.
 * 3. Đã loại bỏ UI, tối ưu cho backend service.
 */

// =================================================================================
// ⚙️ 1. Cấu hình & Biến môi trường
// =================================================================================

// Bun tự động load .env
const API_KEY = process.env.API_KEY || 'default-secret-key';
const PORT = process.env.PORT || 3000;

// Cấu hình Upstream Providers
const PROVIDER_CONFIG = {
  'api.airforce': {
    name: 'Airforce API',
    upstreamHost: 'api.airforce',
    models: ['gpt-5-mini', 'gpt-4o-mini'], // Hardcoded models
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

/**
 * Xây dựng map model -> provider.
 * Chạy 1 lần khi server khởi động hoặc request đầu tiên đến.
 */
async function buildModelProviderMap() {
  console.log("🚀 Đang xây dựng danh mục models...");
  const map = new Map();

  const fetchPromises = Object.entries(PROVIDER_CONFIG).map(async ([providerId, config]) => {
    try {
      // 1. Xử lý model hardcode
      if (config.models && !config.modelsPath) {
        config.models.forEach(modelId => {
          map.set(modelId, { providerId, upstreamHost: config.upstreamHost, chatPath: config.chatPath });
        });
        return;
      }

      // 2. Xử lý model động (fetch từ upstream)
      if (config.modelsPath) {
        const upstreamUrl = `https://${config.upstreamHost}${config.modelsPath}`;
        const response = await fetch(upstreamUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json', 'Origin': 'https://g4f.dev', 'Referer': 'https://g4f.dev/' }
        });
        
        if (!response.ok) {
          // Silent fail để không block các provider khác
          // console.warn(`Provider '${providerId}' trả về status ${response.status}`);
          return; 
        }
        
        const data = await response.json();
        let models = [];

        // Parsing heuristic cho nhiều định dạng output khác nhau
        if (Array.isArray(data)) {
            models = data.map(m => m.id || m.name).filter(Boolean);
        } else if (data.data && Array.isArray(data.data)) {
            models = data.data.map(m => m.id).filter(Boolean);
        } else if (data.models && Array.isArray(data.models)) {
            models = data.models.map(m => m.name).filter(Boolean);
        }
       
        models.forEach(modelId => {
          map.set(modelId, { providerId, upstreamHost: config.upstreamHost, chatPath: config.chatPath });
        });
      }
    } catch (error) {
      console.error(`Lỗi fetch provider '${providerId}': ${error.message}`);
    }
  });

  await Promise.allSettled(fetchPromises);
  MODEL_PROVIDER_MAP = map;
  console.log(`✅ Đã xây dựng xong map. Tổng số model: ${MODEL_PROVIDER_MAP.size}`);
}

// =================================================================================
// 🔌 3. Request Handlers
// =================================================================================

async function handleChatCompletionRequest(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized', message: 'Invalid API Key' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
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
            message: `Model '${modelId}' không tồn tại. Kiểm tra /v1/models.` 
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      const { upstreamHost, chatPath } = providerInfo;
      const upstreamUrl = `https://${upstreamHost}${chatPath}`;

      // Headers giả lập browser để tránh bị chặn
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', '*/*');
      headers.set('Origin', 'https://g4f.dev');
      headers.set('Referer', 'https://g4f.dev/');
      headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        redirect: 'follow'
      });

      // Proxy response (hỗ trợ streaming)
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

// Pre-load map (non-blocking, server sẽ start ngay nhưng request đầu có thể phải đợi nếu map chưa xong)
buildModelProviderMap();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

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

    // Đảm bảo map đã load trước khi xử lý request
    if (MODEL_PROVIDER_MAP === null) {
      await buildModelProviderMap();
    }

    // Routing
    if (url.pathname === '/v1/models') {
      return handleModelsRequest();
    }

    if (url.pathname === '/v1/chat/completions') {
      return handleChatCompletionRequest(req);
    }

    // Health check / Root
    if (url.pathname === '/') {
        return new Response(JSON.stringify({ status: 'ok', service: 'Bun AI Gateway v3.0', models_count: MODEL_PROVIDER_MAP ? MODEL_PROVIDER_MAP.size : 0 }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response('Not Found', { status: 404 });
  },
});
