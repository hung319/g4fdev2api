/**
 * Bun AI Gateway v3.3 (Stable Fix)
 * - Fix: Đồng bộ Headers giữa việc lấy Model và Chat (quan trọng để tránh bị chặn).
 * - Feature: Hỗ trợ Namespacing (Airforce/gpt-4o) và tự động strip prefix khi gọi upstream.
 */

const API_KEY = process.env.API_KEY || '1'; // Default key: 1
const PORT = process.env.PORT || 3000;

// =================================================================================
// 🛡️ 0. Cấu hình Headers Giả lập (QUAN TRỌNG)
// =================================================================================

// Bộ headers này copy chuẩn từ curl request của bạn để bypass Cloudflare/WAF
const COMMON_HEADERS = {
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

// =================================================================================
// ⚙️ 1. Cấu hình Providers
// =================================================================================

const PROVIDER_CONFIG = {
  'airforce': { 
    name: 'Airforce API',
    upstreamHost: 'api.airforce',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions'
  },
  'anondrop': {
    name: 'AnonDrop',
    upstreamHost: 'anondrop.net',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions'
  },
  'gpt4free': {
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
  console.log("🚀 Đang cập nhật danh sách models...");
  const map = new Map();

  const fetchPromises = Object.entries(PROVIDER_CONFIG).map(async ([providerKey, config]) => {
    try {
      let models = [];

      // 1. Lấy danh sách model
      if (config.models) {
        models = config.models;
      } else if (config.modelsPath) {
        const upstreamUrl = `https://${config.upstreamHost}${config.modelsPath}`;
        
        // Dùng COMMON_HEADERS để tránh bị chặn khi lấy list
        const response = await fetch(upstreamUrl, { 
            method: 'GET', 
            headers: COMMON_HEADERS 
        });
        
        if (!response.ok) return;
        const data = await response.json();
        
        // Parsing logic đa dạng
        if (Array.isArray(data)) {
            models = data.map(m => m.id || m.name).filter(Boolean);
        } else if (data.data && Array.isArray(data.data)) {
            models = data.data.map(m => m.id).filter(Boolean);
        } else if (data.models && Array.isArray(data.models)) {
            models = data.models.map(m => m.name).filter(Boolean);
        }
      }

      // 2. Lưu vào Map (Lưu cả tên gốc và tên có prefix)
      models.forEach(originalModelId => {
        const providerData = { 
            providerId: providerKey, 
            upstreamHost: config.upstreamHost, 
            chatPath: config.chatPath,
            targetModelId: originalModelId // ID gốc để gửi đi
        };

        // Key 1: Có prefix (Ví dụ: airforce/gpt-4o)
        map.set(`${providerKey}/${originalModelId}`, providerData);

        // Key 2: Không prefix (Ví dụ: gpt-4o) - Fallback cho client cũ
        // Chỉ set nếu chưa có (ưu tiên provider đầu tiên trong list)
        if (!map.has(originalModelId)) {
            map.set(originalModelId, providerData);
        }
      });
      console.log(`  -> [${providerKey}] OK: ${models.length} models`);

    } catch (error) {
      console.error(`  -> [${providerKey}] Error: ${error.message}`);
    }
  });

  await Promise.allSettled(fetchPromises);
  MODEL_PROVIDER_MAP = map;
  console.log(`✅ Hoàn tất. Tổng entries: ${MODEL_PROVIDER_MAP.size}`);
}

// =================================================================================
// 🔌 3. Chat Handler (Fixed)
// =================================================================================

async function handleChatCompletionRequest(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // 1. Auth Check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
      // 2. Parse Body & Validate Model
      const requestBody = await req.json();
      const incomingModelId = requestBody.model;

      if (!incomingModelId) {
        return new Response(JSON.stringify({ error: 'Missing model' }), { status: 400 });
      }

      const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);

      if (!providerInfo) {
        return new Response(JSON.stringify({ 
            error: 'Model Not Found', 
            message: `Model '${incomingModelId}' không tồn tại. Hãy kiểm tra /v1/models` 
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      // 3. Chuẩn bị Request Upstream
      const { upstreamHost, chatPath, targetModelId } = providerInfo;
      const upstreamUrl = `https://${upstreamHost}${chatPath}`;

      // ⚠️ QUAN TRỌNG: Thay thế model ID bằng ID gốc (bỏ prefix)
      const upstreamBody = {
          ...requestBody,
          model: targetModelId 
      };

      // 4. Gửi Request với COMMON_HEADERS đầy đủ
      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: COMMON_HEADERS, // Dùng lại bộ headers chuẩn
        body: JSON.stringify(upstreamBody),
        redirect: 'follow'
      });

      // 5. Proxy Response về client
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: {
          'Content-Type': upstreamResponse.headers.get('Content-Type') || 'text/event-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });

  } catch (error) {
      console.error("Chat Error:", error);
      return new Response(JSON.stringify({ error: 'Internal Error', message: error.message }), { status: 500 });
  }
}

// =================================================================================
// 🚀 4. Server Entry
// =================================================================================

console.log(`🚀 Starting Bun AI Gateway v3.3 on port ${PORT}...`);
buildModelProviderMap();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS Handling
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        });
    }

    // Lazy Loading Map
    if (MODEL_PROVIDER_MAP === null) await buildModelProviderMap();

    // Routing
    if (url.pathname === '/v1/models') {
        return handleModelsRequest();
    }
    
    if (url.pathname === '/v1/chat/completions') {
        return handleChatCompletionRequest(req);
    }

    if (url.pathname === '/') {
        return new Response(JSON.stringify({ 
            status: 'ok', 
            service: 'Bun AI Gateway v3.3', 
            models_count: MODEL_PROVIDER_MAP ? MODEL_PROVIDER_MAP.size : 0 
        }), { headers: { 'Content-Type': 'application/json' }});
    }

    return new Response('Not Found', { status: 404 });
  },
});

function handleModelsRequest() {
  if (!MODEL_PROVIDER_MAP) return new Response('{}', { status: 503 });

  // Trả về danh sách tất cả model (gồm cả tên gốc và tên có prefix)
  const modelsData = Array.from(MODEL_PROVIDER_MAP.entries()).map(([id, info]) => ({
    id: id, 
    object: 'model',
    owned_by: info.providerId,
  }));

  return new Response(JSON.stringify({ object: 'list', data: modelsData }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
