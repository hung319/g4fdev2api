/**
 * Bun AI Gateway v3.6 (Full Restore Edition)
 * - Restored: Khôi phục đầy đủ 8 Providers từ file gốc.
 * - Upgraded: Airforce (Dynamic), HuggingFace (Fix), Headers (Anti-block).
 * - Mode: Strict Namespace (Bắt buộc dùng format 'provider/model').
 */

const API_KEY = process.env.API_KEY || '1'; 
const PORT = process.env.PORT || 3000;

// =================================================================================
// 🛡️ 0. Headers Giả lập (Common Headers)
// =================================================================================
const COMMON_HEADERS = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
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
// ⚙️ 1. Cấu hình Providers (Full 8 Sources)
// =================================================================================

const PROVIDER_CONFIG = {
  // 1. Airforce (Đã nâng cấp lên Dynamic theo yêu cầu cũ của bạn)
  'airforce': { 
    name: 'Airforce API',
    upstreamHost: 'api.airforce',
    modelsPath: '/v1/models', 
    chatPath: '/v1/chat/completions'
  },
  // 2. AnonDrop (Khôi phục)
  'anondrop': {
    name: 'AnonDrop',
    upstreamHost: 'anondrop.net',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions'
  },
  // 3. GPT4Free (Khôi phục)
  'gpt4free': {
    name: 'GPT4Free.pro',
    upstreamHost: 'gpt4free.pro',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions'
  },
  // 4. Gemini (Khôi phục)
  'gemini': {
    name: 'Google Gemini',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/gemini/models',
    chatPath: '/api/gemini/chat/completions'
  },
  // 5. Grok (Khôi phục)
  'grok': {
    name: 'Grok',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/grok/models',
    chatPath: '/api/grok/chat/completions'
  },
  // 6. Pollinations (Khôi phục)
  'pollinations': {
    name: 'Pollinations.ai',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/pollinations.ai/models',
    chatPath: '/api/pollinations.ai/chat/completions'
  },
  // 7. Ollama (Khôi phục)
  'ollama': {
    name: 'Ollama',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/ollama/models',
    chatPath: '/api/ollama/chat/completions'
  },
  // 8. HuggingFace (Giữ bản Fix v3.5)
  'huggingface': {
    name: 'HuggingFace',
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
  console.log("🚀 Đang cập nhật danh sách models từ 8 nguồn...");
  const map = new Map();

  const fetchPromises = Object.entries(PROVIDER_CONFIG).map(async ([providerKey, config]) => {
    try {
      let models = [];

      // Fetch từ Upstream
      if (config.modelsPath) {
        const upstreamUrl = `https://${config.upstreamHost}${config.modelsPath}`;
        
        const response = await fetch(upstreamUrl, { 
            method: 'GET', 
            headers: COMMON_HEADERS 
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Parsing Logic đa năng
            if (Array.isArray(data)) {
                models = data.map(m => m.id || m.name).filter(Boolean);
            } else if (data.data && Array.isArray(data.data)) {
                models = data.data.map(m => m.id).filter(Boolean);
            } else if (data.models && Array.isArray(data.models)) {
                models = data.models.map(m => m.name).filter(Boolean);
            }
        } else {
            // Chỉ warn nhẹ để không spam log, vì một số nguồn g4f thi thoảng chết
            // console.warn(`  ⚠️ [${providerKey}] Status: ${response.status}`);
        }
      }

      // Đăng ký vào Map (Format: provider/model)
      models.forEach(originalModelId => {
        const namespacedId = `${providerKey}/${originalModelId}`;
        
        map.set(namespacedId, { 
            providerId: providerKey, 
            upstreamHost: config.upstreamHost, 
            chatPath: config.chatPath,
            targetModelId: originalModelId // Lưu ID gốc
        });
      });
      
      if (models.length > 0) {
          console.log(`  -> [${providerKey}] OK: ${models.length} models`);
      } else {
          console.log(`  -> [${providerKey}] Không tìm thấy models (hoặc API lỗi).`);
      }

    } catch (error) {
      console.error(`  -> [${providerKey}] Error: ${error.message}`);
    }
  });

  await Promise.allSettled(fetchPromises);
  MODEL_PROVIDER_MAP = map;
  console.log(`✅ Hoàn tất. Tổng model khả dụng: ${MODEL_PROVIDER_MAP.size}`);
}

// =================================================================================
// 🔌 3. Chat Handler (Strict Routing)
// =================================================================================

async function handleChatCompletionRequest(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
      const requestBody = await req.json();
      const incomingModelId = requestBody.model; 

      if (!incomingModelId) {
        return new Response(JSON.stringify({ error: 'Missing model' }), { status: 400 });
      }

      // Lookup Map
      const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);

      if (!providerInfo) {
        return new Response(JSON.stringify({ 
            error: 'Model Not Found', 
            message: `Model '${incomingModelId}' không tồn tại. Định dạng đúng: 'provider/model'. Kiểm tra /v1/models` 
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      // Routing Info
      const { upstreamHost, chatPath, targetModelId } = providerInfo;
      const upstreamUrl = `https://${upstreamHost}${chatPath}`;

      // Strip Prefix
      const upstreamBody = {
          ...requestBody,
          model: targetModelId 
      };

      // console.log(`🔄 Routing: ${incomingModelId} -> ${upstreamHost}`);

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
      return new Response(JSON.stringify({ error: 'Internal Error', message: error.message }), { status: 500 });
  }
}

// =================================================================================
// 🚀 4. Server Entry
// =================================================================================

console.log(`🚀 Starting Bun AI Gateway v3.6 on port ${PORT}...`);
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
    
    if (url.pathname === '/') {
        return new Response(JSON.stringify({ 
            status: 'ok', 
            service: 'Bun AI Gateway v3.6',
            providers_configured: Object.keys(PROVIDER_CONFIG).length,
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
