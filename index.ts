/**
 * Bun AI Gateway v4.4 (n8n Debug Edition)
 * - Feature: Extensive Logging cho Endpoint tạo ảnh.
 * - Fix: Xử lý lỗi Upstream rõ ràng (trả về JSON error thay vì stream rác).
 * - Target: Tối ưu cho n8n HTTP Request Node.
 */

const API_KEY = process.env.API_KEY || '1'; 
const PORT = process.env.PORT || 3000;

// =================================================================================
// 🛡️ 0. Headers Giả lập (Giữ nguyên từ bản ổn định)
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
  // ... (Các provider khác giữ nguyên để code gọn, logic map tự động xử lý)
  'pollinations': {
    name: 'Pollinations',
    upstreamHost: 'g4f.dev',
    modelsPath: '/api/pollinations.ai/models',
    chatPath: '/api/pollinations.ai/chat/completions',
    imagePath: '/api/pollinations.ai/images/generations'
  }
};

// =================================================================================
// 🧠 2. Core Logic: Model Map Builder
// =================================================================================

let MODEL_PROVIDER_MAP = null;

async function buildModelProviderMap() {
  console.log("🚀 [System] Đang cập nhật danh sách models...");
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

    } catch (error) {
      console.error(`  -> [${providerKey}] Error: ${error.message}`);
    }
  });

  await Promise.allSettled(fetchPromises);
  MODEL_PROVIDER_MAP = map;
  console.log(`✅ [System] Hoàn tất. Tổng model: ${MODEL_PROVIDER_MAP.size}`);
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
      
      const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);
      if (!providerInfo) return new Response(JSON.stringify({error: `Model '${incomingModelId}' not found`}), { status: 404 });

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

// --- Image Handler (DEBUG MODE) ---
async function handleImageGenerationRequest(req) {
    console.log('\n📸 [IMAGE] Nhận request tạo ảnh...');
    
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    
    // Auth Check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        console.warn('📸 [IMAGE] ❌ Lỗi Auth: Sai Key');
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const requestBody = await req.json();
        const incomingModelId = requestBody.model; 
        const prompt = requestBody.prompt;

        console.log(`📸 [IMAGE] Model requested: ${incomingModelId}`);
        console.log(`📸 [IMAGE] Prompt: "${prompt ? prompt.substring(0, 50) + '...' : 'No Prompt'}"`);

        if (!incomingModelId) return new Response(JSON.stringify({error: 'Missing model'}), { status: 400 });

        const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);
        
        if (!providerInfo) {
             console.error(`📸 [IMAGE] ❌ Model không tìm thấy trong Map.`);
             return new Response(JSON.stringify({error: `Model '${incomingModelId}' not found.`}), { status: 404 });
        }
        if (!providerInfo.imagePath) {
            console.error(`📸 [IMAGE] ❌ Provider ${providerInfo.providerId} không hỗ trợ ảnh.`);
            return new Response(JSON.stringify({error: `Provider '${providerInfo.providerId}' does not support image generation.`}), { status: 400 });
        }

        const upstreamUrl = `https://${providerInfo.upstreamHost}${providerInfo.imagePath}`;
        console.log(`📸 [IMAGE] Gửi request tới: ${upstreamUrl}`);
        console.log(`📸 [IMAGE] Target Model: ${providerInfo.targetModelId}`);

        const upstreamBody = { 
            model: providerInfo.targetModelId, 
            prompt: prompt,
            response_format: requestBody.response_format 
        };

        const startTime = Date.now();
        const upstreamResponse = await fetch(upstreamUrl, {
            method: 'POST',
            headers: COMMON_HEADERS,
            body: JSON.stringify(upstreamBody)
        });
        const duration = Date.now() - startTime;

        console.log(`📸 [IMAGE] Upstream Status: ${upstreamResponse.status} (${duration}ms)`);
        
        const contentType = upstreamResponse.headers.get('content-type');
        console.log(`📸 [IMAGE] Upstream Content-Type: ${contentType}`);

        // XỬ LÝ LỖI UPSTREAM
        if (!upstreamResponse.ok) {
            const errorText = await upstreamResponse.text();
            console.error(`📸 [IMAGE] ❌ LỖI TỪ UPSTREAM:\n${errorText}`);
            return new Response(JSON.stringify({ 
                error: 'Upstream Error', 
                status: upstreamResponse.status,
                upstream_message: errorText 
            }), { 
                status: upstreamResponse.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // THÀNH CÔNG -> STREAM ẢNH
        console.log(`📸 [IMAGE] ✅ Thành công! Đang stream binary về n8n...`);
        return new Response(upstreamResponse.body, {
            status: 200,
            headers: {
                // n8n cần Content-Type chuẩn để nhận diện file
                'Content-Type': contentType || 'image/jpeg',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache',
                // Gợi ý tên file cho n8n
                'Content-Disposition': `attachment; filename="generated-${Date.now()}.jpg"`
            }
        });

    } catch (error) {
        console.error(`📸 [IMAGE] ❌ Exception: ${error.message}`);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

// =================================================================================
// 🚀 4. Server Entry
// =================================================================================

console.log(`🚀 Starting Bun AI Gateway v4.4 (n8n Debug) on port ${PORT}...`);
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
    
    if (url.pathname === '/') return new Response('Bun AI Gateway v4.4 Active');

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
