/**
 * Bun AI Gateway v3.4 (Strict Namespace & HF Fix)
 * - Fix HuggingFace: Cải thiện parsing logic & thêm fallback models cứng.
 * - Strict Mode: Tên model BẮT BUỘC phải kèm tên provider (VD: airforce/gpt-4o).
 */

const API_KEY = process.env.API_KEY || '1'; 
const PORT = process.env.PORT || 3000;

// =================================================================================
// 🛡️ 0. Headers Giả lập (Chống chặn)
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
// ⚙️ 1. Cấu hình Providers
// =================================================================================

const PROVIDER_CONFIG = {
  // ✅ 1. Airforce (Động)
  'airforce': { 
    name: 'Airforce API',
    upstreamHost: 'api.airforce',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions'
  },
  // ✅ 2. HuggingFace (Đã sửa logic fetch)
  'huggingface': {
    name: 'HuggingFace (via g4f)',
    upstreamHost: 'g4f.dev',
    // Endpoint này thường trả về mảng các object { model: "..." }
    modelsPath: '/api/huggingface/models', 
    chatPath: '/api/huggingface/chat/completions',
    // Fallback nếu fetch thất bại hoặc trả về rỗng
    fallbackModels: [
        'meta-llama/Meta-Llama-3-8B-Instruct',
        'meta-llama/Llama-2-7b-chat-hf',
        'mistralai/Mistral-7B-Instruct-v0.2',
        'Qwen/Qwen2.5-72B-Instruct',
        'Qwen/Qwen1.5-110B-Chat',
        'google/gemma-7b-it',
        'microsoft/Phi-3-mini-4k-instruct'
    ]
  },
  // ✅ 3. Các provider khác
  'gpt4free': {
    name: 'GPT4Free',
    upstreamHost: 'gpt4free.pro',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions'
  },
  'gemini': {
    name: 'Gemini',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/gemini/models',
    chatPath: '/api/gemini/chat/completions'
  },
  'ollama': {
    name: 'Ollama',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/ollama/models',
    chatPath: '/api/ollama/chat/completions'
  },
  'blackbox': {
      name: 'Blackbox',
      upstreamHost: 'g4f.dev',
      modelsPath: '/api/blackbox/models',
      chatPath: '/api/blackbox/chat/completions'
  }
};

// =================================================================================
// 🧠 2. Core Logic: Model Map Builder (Strict Mode)
// =================================================================================

let MODEL_PROVIDER_MAP = null;

async function buildModelProviderMap() {
  console.log("🚀 Đang cập nhật danh sách models (Strict Namespace Mode)...");
  const map = new Map();

  const fetchPromises = Object.entries(PROVIDER_CONFIG).map(async ([providerKey, config]) => {
    try {
      let models = [];
      let fetchSuccess = false;

      // --- A. Cố gắng Fetch từ Upstream ---
      if (config.modelsPath) {
        const upstreamUrl = `https://${config.upstreamHost}${config.modelsPath}`;
        try {
            const response = await fetch(upstreamUrl, { method: 'GET', headers: COMMON_HEADERS });
            if (response.ok) {
                const data = await response.json();
                
                // Logic Parse thông minh (đã bổ sung cho HuggingFace)
                if (Array.isArray(data)) {
                    // HF thường trả về: [{model: "xyz"}, ...] hoặc ["xyz", ...]
                    models = data.map(m => {
                        if (typeof m === 'string') return m;
                        return m.id || m.name || m.model; // ✅ Thêm check m.model
                    }).filter(Boolean);
                } else if (data.data && Array.isArray(data.data)) {
                    models = data.data.map(m => m.id).filter(Boolean);
                } else if (data.models && Array.isArray(data.models)) {
                    models = data.models.map(m => m.name).filter(Boolean);
                }
                
                if (models.length > 0) fetchSuccess = true;
            }
        } catch (e) {
            console.warn(`  ⚠️ [${providerKey}] Fetch failed: ${e.message}`);
        }
      }

      // --- B. Dùng Fallback nếu Fetch thất bại ---
      if (!fetchSuccess && config.fallbackModels) {
          console.log(`  ℹ️ [${providerKey}] Sử dụng danh sách Fallback (${config.fallbackModels.length} models).`);
          models = config.fallbackModels;
      }

      // --- C. Đăng ký vào Map (Chỉ dùng tên có Prefix) ---
      models.forEach(originalModelId => {
        // Tạo tên định danh duy nhất: provider/model
        const namespacedId = `${providerKey}/${originalModelId}`;
        
        map.set(namespacedId, { 
            providerId: providerKey, 
            upstreamHost: config.upstreamHost, 
            chatPath: config.chatPath,
            targetModelId: originalModelId // Lưu ID gốc để gửi đi upstream
        });
      });
      
      console.log(`  -> [${providerKey}] OK: ${models.length} models`);

    } catch (error) {
      console.error(`  -> [${providerKey}] Fatal Error: ${error.message}`);
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
      const incomingModelId = requestBody.model; // Ví dụ: "huggingface/Qwen/Qwen2.5-72B-Instruct"

      if (!incomingModelId) {
        return new Response(JSON.stringify({ error: 'Missing model' }), { status: 400 });
      }

      // Tìm trong Map (Key phải khớp chính xác 100% bao gồm prefix)
      const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);

      if (!providerInfo) {
        return new Response(JSON.stringify({ 
            error: 'Model Not Found', 
            message: `Model '${incomingModelId}' không tồn tại. Vui lòng dùng định dạng 'provider/model-name'. Kiểm tra /v1/models` 
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      // Chuẩn bị gửi Upstream
      const { upstreamHost, chatPath, targetModelId } = providerInfo;
      const upstreamUrl = `https://${upstreamHost}${chatPath}`;

      // ✅ Thay thế ID bằng ID gốc (bỏ prefix)
      const upstreamBody = {
          ...requestBody,
          model: targetModelId 
      };

      console.log(`🔄 Routing: ${incomingModelId} -> ${upstreamHost} (Model: ${targetModelId})`);

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

console.log(`🚀 Starting Bun AI Gateway v3.4 on port ${PORT}...`);
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
    
    // Root trả về thông tin service
    if (url.pathname === '/') {
        return new Response(JSON.stringify({ 
            status: 'ok', 
            service: 'Bun AI Gateway v3.4',
            mode: 'Strict Namespace (provider/model)',
            models_count: MODEL_PROVIDER_MAP ? MODEL_PROVIDER_MAP.size : 0 
        }), { headers: { 'Content-Type': 'application/json' }});
    }

    return new Response('Not Found', { status: 404 });
  },
});

function handleModelsRequest() {
  if (!MODEL_PROVIDER_MAP) return new Response('{}', { status: 503 });

  // Trả về danh sách chỉ chứa tên đã namespace
  const modelsData = Array.from(MODEL_PROVIDER_MAP.entries()).map(([id, info]) => ({
    id: id, // Luôn là "provider/model"
    object: 'model',
    owned_by: info.providerId,
  }));

  return new Response(JSON.stringify({ object: 'list', data: modelsData }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
