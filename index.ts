/**
 * Bun AI Gateway v3.2
 * - Feature: Namespacing models (Provider/ModelName) để tránh trùng lặp.
 * - Logic: Tự động strip prefix khi gửi request upstream.
 */

const API_KEY = process.env.API_KEY || 'default-secret-key';
const PORT = process.env.PORT || 3000;

// Cấu hình Upstream Providers
// Lưu ý: Key của object này sẽ được dùng làm prefix (ví dụ: 'airforce' -> 'airforce/gpt-4o')
const PROVIDER_CONFIG = {
  'airforce': {  // Đổi tên key ngắn gọn hơn để prefix đẹp hơn
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
  // ... các provider khác giữ nguyên hoặc đổi key ngắn gọn tùy ý
};

// =================================================================================
// 🧠 Core Logic: Model Map Builder (Đã nâng cấp)
// =================================================================================

let MODEL_PROVIDER_MAP = null;

async function buildModelProviderMap() {
  console.log("🚀 Đang xây dựng danh mục models (có Namespacing)...");
  const map = new Map();

  const fetchPromises = Object.entries(PROVIDER_CONFIG).map(async ([providerKey, config]) => {
    try {
      let models = [];

      // 1. Fetch hoặc dùng Hardcode
      if (config.models && !config.modelsPath) {
        models = config.models;
      } else if (config.modelsPath) {
        const upstreamUrl = `https://${config.upstreamHost}${config.modelsPath}`;
        
        // Headers giả lập (như phiên bản trước)
        const headers = {
            'accept': '*/*',
            'content-type': 'application/json',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
        };

        const response = await fetch(upstreamUrl, { method: 'GET', headers });
        if (!response.ok) return;
        
        const data = await response.json();
        
        // Parsing logic
        if (Array.isArray(data)) {
            models = data.map(m => m.id || m.name).filter(Boolean);
        } else if (data.data && Array.isArray(data.data)) {
            models = data.data.map(m => m.id).filter(Boolean);
        } else if (data.models && Array.isArray(data.models)) {
            models = data.models.map(m => m.name).filter(Boolean);
        }
      }

      // 2. Đăng ký Model vào Map
      models.forEach(originalModelId => {
        const providerData = { 
            providerId: providerKey, 
            upstreamHost: config.upstreamHost, 
            chatPath: config.chatPath,
            targetModelId: originalModelId // ✅ Lưu ID gốc để gửi upstream
        };

        // A. Tạo tên định danh: "airforce/gpt-4o"
        const namespacedId = `${providerKey}/${originalModelId}`;
        map.set(namespacedId, providerData);

        // B. (Tùy chọn) Giữ tên gốc "gpt-4o" làm fallback
        // Chỉ set nếu chưa có, giúp model "đến trước" được ưu tiên làm default
        if (!map.has(originalModelId)) {
            map.set(originalModelId, providerData);
        }
      });
      
      console.log(`  -> ${providerKey}: +${models.length} models`);

    } catch (error) {
      console.error(`❌ Lỗi provider '${providerKey}': ${error.message}`);
    }
  });

  await Promise.allSettled(fetchPromises);
  MODEL_PROVIDER_MAP = map;
  console.log(`✅ Hoàn tất. Tổng model entry: ${MODEL_PROVIDER_MAP.size}`);
}

// =================================================================================
// 🔌 Request Handlers
// =================================================================================

async function handleChatCompletionRequest(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
      const requestBody = await req.json();
      const incomingModelId = requestBody.model; // Ví dụ: "airforce/gpt-4o"

      if (!incomingModelId) {
        return new Response(JSON.stringify({ error: 'Missing model' }), { status: 400 });
      }

      const providerInfo = MODEL_PROVIDER_MAP.get(incomingModelId);

      if (!providerInfo) {
        return new Response(JSON.stringify({ 
            error: 'Model Not Found', 
            message: `Model '${incomingModelId}' không tồn tại.` 
        }), { status: 404 });
      }

      // ✅ TRICK: Thay thế model ID trong body bằng model ID gốc
      // Ví dụ: User gửi "airforce/gpt-4o" -> Ta sửa thành "gpt-4o" trước khi gửi cho Airforce
      const upstreamBody = {
          ...requestBody,
          model: providerInfo.targetModelId 
      };

      const upstreamUrl = `https://${providerInfo.upstreamHost}${providerInfo.chatPath}`;

      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('User-Agent', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36');
      // Thêm các header cần thiết khác...

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(upstreamBody), // Gửi body đã sửa
        redirect: 'follow'
      });

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': upstreamResponse.headers.get('Content-Type') || 'text/event-stream',
          'Access-Control-Allow-Origin': '*',
        }
      });

  } catch (error) {
      return new Response(JSON.stringify({ error: 'Internal Error', message: error.message }), { status: 500 });
  }
}

// ... Phần handleModelsRequest và Bun.serve giữ nguyên như cũ ...
// (Lưu ý: handleModelsRequest sẽ tự động trả về danh sách có cả tên gốc và tên có prefix vì chúng đều nằm trong Map)

// Code phần server start
console.log(`🚀 Starting Bun AI Gateway on port ${PORT}...`);
buildModelProviderMap();

Bun.serve({
    port: PORT,
    async fetch(req) {
        // ... (giữ nguyên logic routing cũ)
        const url = new URL(req.url);
        if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } });
        if (MODEL_PROVIDER_MAP === null) await buildModelProviderMap();

        if (url.pathname === '/v1/models') return handleModelsRequest();
        if (url.pathname === '/v1/chat/completions') return handleChatCompletionRequest(req);
        
        return new Response('Not Found', { status: 404 });
    }
});

// Hàm handleModelsRequest cho đầy đủ context (chèn vào nếu cần)
function handleModelsRequest() {
  if (!MODEL_PROVIDER_MAP) return new Response('{}', { status: 503 });
  
  // Map entry bao gồm cả 2 loại key (có prefix và không prefix). 
  // Code này sẽ trả về TẤT CẢ.
  const modelsData = Array.from(MODEL_PROVIDER_MAP.entries()).map(([id, info]) => ({
    id: id, // Đây sẽ là "airforce/gpt-4o" hoặc "gpt-4o"
    object: 'model',
    owned_by: info.providerId,
    permission: []
  }));

  return new Response(JSON.stringify({ object: 'list', data: modelsData }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
