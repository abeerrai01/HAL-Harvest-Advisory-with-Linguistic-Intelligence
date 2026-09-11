import axios from 'axios';
import { Platform } from 'react-native';

// Physical device IPs to try (in order)
const DEVICE_IPs = [
   '10.6.8.37',
  '192.168.137.128',
  '10.3.2.173',
  
];

// TEMP: Force base URL for testing on physical device
// Set to null to try all IPs, or specify a single IP to force
const FORCED_BASE_URL = null; // Try all IPs

const resolvedBaseURL = (() => {
  // PRODUCTION: Always use Vercel API in production builds (APK/IPA)
  // __DEV__ is false in production builds, so this ensures production always uses Vercel
  if (!__DEV__) {
    return 'https://apis-hal.vercel.app';
  }

  // DEVELOPMENT: Only use local/device IPs in development mode
  
  // Highest priority: explicit env override (useful for development on physical devices)
  if (process.env.EXPO_PUBLIC_HAL_API_URL) return process.env.EXPO_PUBLIC_HAL_API_URL;
  
  // If FORCED_BASE_URL is set, use it
  if (FORCED_BASE_URL) return FORCED_BASE_URL;
  
  // If FORCED_BASE_URL is null but we have DEVICE_IPs, try first one
  if (DEVICE_IPs.length > 0) {
    // Try first IP from the list
    return `http://${DEVICE_IPs[0]}:5050`;
  }

  // Default development URLs (only reached in __DEV__ mode)
  // Android emulator can't reach host via localhost; use 10.0.2.2
  if (Platform.OS === 'android') return 'http://10.0.2.2:5050';
  // iOS simulator and web can use localhost
  return 'http://localhost:5050';
})();

// Create axios instance with automatic IP fallback
const createApiInstance = (baseURL) => {
  return axios.create({
    baseURL,
    timeout: 30000,
  });
};

let api = createApiInstance(resolvedBaseURL);

// Function to try alternative IPs if request fails
const tryAlternativeIPs = async (originalRequest) => {
  // Only try alternative IPs in development and if we have a network error
  if (!__DEV__ || !originalRequest.config) return Promise.reject(originalRequest);
  
  const currentURL = originalRequest.config.baseURL || resolvedBaseURL;
  const currentIP = currentURL.match(/http:\/\/([^:]+):/)?.[1];
  
  // Find next IP to try
  const currentIndex = currentIP ? DEVICE_IPs.indexOf(currentIP) : -1;
  const nextIndex = currentIndex >= 0 && currentIndex < DEVICE_IPs.length - 1 
    ? currentIndex + 1 
    : 0;
  
  if (nextIndex !== currentIndex && DEVICE_IPs[nextIndex]) {
    const nextIP = DEVICE_IPs[nextIndex];
    const newBaseURL = `http://${nextIP}:5050`;
    
    console.log(`🔄 Trying alternative IP: ${nextIP}`);
    
    // Create new axios instance with alternative IP
    api = createApiInstance(newBaseURL);
    
    // Retry the original request with new base URL
    originalRequest.config.baseURL = newBaseURL;
    return api.request(originalRequest.config);
  }
  
  return Promise.reject(originalRequest);
};

// Add response interceptor to handle IP fallback
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // If it's a network error and we're in dev mode, try alternative IPs
    if (error.code === 'NETWORK_ERROR' || error.message?.includes('Network Error') || error.message?.includes('timeout')) {
      return tryAlternativeIPs(error);
    }
    return Promise.reject(error);
  }
);

// Debug: Log the API URL being used
if (__DEV__) {
  console.log('🌐 HAL API Base URL (DEV):', resolvedBaseURL);
  if (DEVICE_IPs.length > 1) {
    console.log('📡 Alternative IPs available:', DEVICE_IPs.slice(1).join(', '));
  }
} else {
  // Log in production too (can be removed if you prefer)
  console.log('🌐 HAL API Base URL (PROD):', resolvedBaseURL);
}

export async function askAssistant({ query, language = 'en', location = 'India' }) {
  const { data } = await api.post('/api/farmer-assistant', { query, language, location });
  return data;
}

export async function getFields(farmer_ID) {
  const { data } = await api.get('/api/v1/fields', { params: { farmer_ID } });
  return data;
}

export async function createField({ farmer_ID, field_name, geometry }) {
  const { data } = await api.post('/api/v1/fields', { farmer_ID, field_name, geometry });
  return data;
}

export async function createJob({ field_ID, farmer_ID, job_type = 'CROP_HEALTH_ANALYSIS', advisory_params = null }) {
  const body = { field_ID, farmer_ID, job_type };
  if (advisory_params) {
    body.advisory_params = advisory_params;
  }
  const { data } = await api.post('/api/v1/jobs', body);
  return data;
}

export async function getJobStatus(job_id) {
  const { data } = await api.get(`/api/v1/jobs/${job_id}`);
  return data;
}

export async function getFieldJobs(field_ID, farmer_ID = null) {
  const params = farmer_ID 
    ? { field_ID, farmer_ID } 
    : { field_ID };
  const { data } = await api.get('/api/v1/jobs', { params });
  return data;
}

export async function getUserJobs(farmer_ID) {
  const { data } = await api.get('/api/v1/jobs', { params: { farmer_ID } });
  return data;
}

export async function getReport(field_ID, farmer_ID) {
  const { data } = await api.get('/api/v1/reports', { params: { field_ID, farmer_ID } });
  return data;
}

export async function getAiRecommendations(reportData, farmer_ID, field_ID, language, currentCrop = null, extractedTextFromCard = null, advisoryParams = null) {
  // AI recommendations can take 30-60 seconds due to Gemini API processing
  // Use a longer timeout for this specific endpoint
  const body = { reportData, farmer_ID, field_ID, language, current_crop: currentCrop };
  if (extractedTextFromCard) {
    body.soil_health_card_text = extractedTextFromCard;
    body.extractedText = extractedTextFromCard;
    body.hasSoilHealthCard = true;
  }
  // Add Uttarakhand-specific advisory parameters
  if (advisoryParams) {
    body.state = advisoryParams.state || 'Uttarakhand';
    body.district = advisoryParams.district;
    body.soil_type = advisoryParams.soil_type;
    body.season = advisoryParams.season;
    body.soil_health_method = advisoryParams.soil_health_method;
    if (advisoryParams.manual_npk) {
      body.manual_npk = advisoryParams.manual_npk;
    }
    if (advisoryParams.irrigation_days_ago !== null && advisoryParams.irrigation_days_ago !== undefined) {
      body.irrigation_days_ago = advisoryParams.irrigation_days_ago;
    }
    // Also send as advisory_params object for backend compatibility
    body.advisory_params = advisoryParams;
  }
  const { data } = await api.post('/api/v1/ai-recommendations', 
    body,
    { timeout: 90000 } // 90 seconds timeout for AI generation
  );
  return data;
}

export async function getSoilAdvisory({ field_ID, farmer_ID, language = 'en', field_location }) {
  const body = { field_ID, farmer_ID, language, field_location };
  const doCall = () => api.post('/api/v1/soil-advisory', body, { timeout: 120000 });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data } = await doCall();
      return data;
    } catch (e) {
      lastErr = e;
      const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.toLowerCase?.().includes('timeout');
      if (!isTimeout || attempt === 3) throw e;
      const backoff = 1500 * attempt;
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

// Fallback Soil API - Crop & Soil Prediction API
const FALLBACK_SOIL_API_BASE_URL = 'https://theabeerrai-crop-and-soil.hf.space';

export async function getSoilAdvisoryFallback({ 
  temp = 27.5, 
  humidity = 60.0, 
  moisture = 40.0, 
  soil_type = 'Loamy', 
  nitrogen = 80, 
  phosphorus = 60, 
  potassium = 100, 
  fertilizer = 'Urea', 
  ph = 6.9 
}) {
  try {
    console.log('🌱 Calling fallback soil API with params:', {
      temp, humidity, moisture, soil_type, nitrogen, phosphorus, potassium, fertilizer, ph
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(FALLBACK_SOIL_API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        temp,
        humidity,
        moisture,
        soil_type,
        nitrogen,
        phosphorus,
        potassium,
        fertilizer,
        ph,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Fallback soil API response:', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error calling fallback soil API:', error);
    throw error;
  }
}

export default api;


// Market prices APIs
export async function getMarketPrices({ commodity, state, district, market, limit = 10 }) {
  const params = { commodity, state, district, market, limit };
  const { data } = await api.get('/api/v1/market-prices', { params, timeout: 30000 });
  return data;
}

export async function getPredictedSellDate({ commodity, state, district, market }) {
  const params = { commodity, state, district, market };
  const { data } = await api.get('/api/v1/market-prices/predict', { params, timeout: 30000 });
  return data;
}

// New prediction API endpoint (HuggingFace)
export async function getPredictedSellDateHF({ crop, marketName, districtName = 'Dehradun', reportedDate }) {
  try {
    const response = await fetch('https://1pankaj-uttarakhand-mandi-price-api.hf.space/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        District_Name: districtName,
        Market_Name: marketName,
        Crop: crop,
        Reported_Date: reportedDate || new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
      }),
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Error calling prediction API:', error);
    throw error;
  }
}

export async function getMarketMeta({ commodity }) {
  const params = { commodity };
  const { data } = await api.get('/api/v1/market-meta', { params, timeout: 20000 });
  return data;
}

// Weather advisory (OpenWeather + Gemini via backend)
export async function getWeatherAdvisory({ lat, lon, language = 'en' }) {
  try {
    console.log('🌦️ Fetching weather advisory:', { lat, lon, language });
  const body = { lat, lon, language };
    // Increased timeout to 60 seconds for weather API (can be slow)
    const { data } = await api.post('/api/v1/weather-advisory', body, { timeout: 60000 });
    console.log('✅ Weather advisory response:', {
      ok: data?.ok,
      hasNow: !!data?.weather?.now,
      hasNext48h: !!data?.weather?.next48h,
      hasAdvisory: !!data?.advisory,
    });
  return data;
  } catch (error) {
    console.error('❌ Weather advisory API error:', error.message);
    throw error;
  }
}

// Fallback Weather API - OpenWeatherMap direct
export async function getWeatherAdvisoryFallback({ lat, lon }) {
  try {
    console.log('🌦️ Using fallback weather API:', { lat, lon });
    
    // Use OpenWeatherMap free tier API directly (requires API key)
    // This is a simple fallback - in production, you'd want a proper weather service
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // Increased to 45 seconds
    
    // For now, return a basic structure - actual implementation would call a weather service
    // This is a placeholder that can be enhanced with actual weather API calls
    const fallbackData = {
      ok: true,
      weather: {
        now: {
          temp: 25,
          feels_like: 26,
          humidity: 65,
          wind_speed: 5,
          weather: 'Clear',
          description: 'Clear sky',
        },
        next48h: Array.from({ length: 24 }, (_, i) => ({
          dt: Math.floor(Date.now() / 1000) + (i * 3600),
          temp: 25 + Math.sin(i / 4) * 3,
          pop: i % 6 === 0 ? 0.3 : 0,
          rain: i % 6 === 0 ? 2 : 0,
        })),
        next7d: Array.from({ length: 7 }, (_, i) => ({
          dt: Math.floor(Date.now() / 1000) + (i * 86400),
          temp_max: 28 + Math.sin(i / 2) * 2,
          temp_min: 22 + Math.sin(i / 2) * 2,
          rain: i % 3 === 0 ? 5 : 0,
        })),
      },
      advisory: {
        risk_summary: 'Weather conditions are favorable for farming activities.',
        actions_now: [
          'Good weather for field work. Proceed with irrigation and fertilization.',
          'Monitor weather changes and plan accordingly.',
        ],
      },
      from_fallback: true,
    };
    
    clearTimeout(timeoutId);
    console.log('✅ Fallback weather data generated');
    return fallbackData;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error in fallback weather API:', error);
    throw error;
  }
}

// Pest & Disease: recommendation via Gemini
export async function getPestRecommendation({ report, language }) {
  const { data } = await api.post('/api/v1/pd-recommendation', { report, language }, { timeout: 30000 });
  return data;
}

// Pest & Disease: history
export async function savePestHistory({ farmer_ID, report }) {
  const { data } = await api.post('/api/v1/pd-history', { farmer_ID, report }, { timeout: 15000 });
  return data;
}

export async function getPestHistory({ farmer_ID, limit = 20 }) {
  const { data } = await api.get('/api/v1/pd-history', { params: { farmer_ID, limit }, timeout: 20000 });
  return data;
}


// Pest & Disease: Image classification (Hugging Face via backend)
export async function classifyDiseaseImage({ uri, base64, model, top_k, farmer_ID }) {
  // Prefer multipart upload if we have a file URI; otherwise send base64
  if (uri) {
    const form = new FormData();
    // Infer filename and type
    const name = uri.split('/').pop() || 'image.jpg';
    const type = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    form.append('image', { uri, name, type });
    if (farmer_ID) form.append('farmer_ID', farmer_ID);
    if (model) form.append('model', model);
    if (top_k) form.append('top_k', String(top_k));
    const { data } = await api.post('/api/v1/pest-disease/classify', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return data;
  } else if (base64) {
    const body = { image_base64: base64, ...(farmer_ID ? { farmer_ID } : {}), ...(model ? { model } : {}), ...(top_k ? { top_k } : {}) };
    const { data } = await api.post('/api/v1/pest-disease/classify', body, { timeout: 60000 });
    return data;
  }
  throw new Error('No image provided');
}

// Speech-to-text (OpenAI Whisper via backend)
export async function transcribeAudio({ uri, base64, filename = 'audio.wav', mime = 'audio/wav', language }) {
  if (uri) {
    const form = new FormData();
    form.append('audio', { uri, name: filename, type: mime });
    if (language) form.append('language', language);
    const { data } = await api.post('/api/v1/stt', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90000 });
    return data;
  } else if (base64) {
    const body = { audio_base64: base64, filename, mime, language };
    const { data } = await api.post('/api/v1/stt', body, { timeout: 90000 });
    return data;
  }
  throw new Error('No audio provided');
}

// Disease chat (Gemini via backend)
export async function diseaseChat({ disease_label, question, context, history = [], language = 'en' }) {
  const body = { disease_label, question, context, history, language };
  const { data } = await api.post('/api/v1/disease-chat', body, { timeout: 45000 });
  return data;
}

// Create WebSocket connection for Gemini Live API
export function createGeminiLiveConnection({ disease_label, context, language, onMessage, onError, onClose }) {
  // Get base URL (similar to how api is configured)
  const baseURL = resolvedBaseURL.replace(/^http/, 'ws');
  const wsUrl = `${baseURL}/api/v1/gemini-live?disease_label=${encodeURIComponent(disease_label)}&context=${encodeURIComponent(context || '')}&language=${encodeURIComponent(language)}`;
  
  console.log('🔌 Connecting to Gemini Live:', wsUrl);
  const ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('✅ WebSocket connected');
    // Initialize connection
    ws.send(JSON.stringify({ type: 'init' }));
  };
  
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (onMessage) onMessage(message);
    } catch (e) {
      console.error('❌ Error parsing WebSocket message:', e);
    }
  };
  
  ws.onerror = (error) => {
    console.error('❌ WebSocket error:', error);
    if (onError) onError(error);
  };
  
  ws.onclose = () => {
    console.log('🔌 WebSocket closed');
    if (onClose) onClose();
  };
  
  return ws;
}

// Government Schemes API (Smart Farmer Advisor)
const SCHEMES_API_BASE_URL = 'https://theabeerrai-schemeai.hf.space';

export async function getGovernmentSchemes({ query, uid, sessionId = 'session_001', locationName = null, lat = null, lon = null }) {
  try {
    // Enhance query with location context if available
    let enhancedQuery = query;
    if (locationName && lat && lon) {
      enhancedQuery = `${query} in ${locationName} and full India`;
    } else if (locationName) {
      enhancedQuery = `${query} in ${locationName} and full India`;
    } else {
      enhancedQuery = `${query} in full India`;
    }

    const url = `${SCHEMES_API_BASE_URL}/schemes?query=${encodeURIComponent(enhancedQuery)}&uid=${uid}&session_id=${sessionId}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error fetching government schemes:', error);
    throw error;
  }
}

export async function resetSchemeChat({ uid, sessionId = 'session_001' }) {
  try {
    const url = `${SCHEMES_API_BASE_URL}/reset_chat?uid=${uid}&session_id=${sessionId}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error resetting scheme chat:', error);
    throw error;
  }
}

// Payal API - Precision Agriculture And Yield Advisory with Linguistic intelligence
const PAYAL_API_BASE_URL = 'https://theabeerrai-payal.hf.space';

// Unified Chat Endpoint - Intelligent routing
export async function payalChat({ query, uid, sessionId, language, lat, lon }) {
  try {
    console.log('🤖 Payal Chat Request:', { query, uid, sessionId, language, lat, lon });
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    
    const body = {
      query,
      ...(uid && { uid }),
      ...(sessionId && { session_id: sessionId }),
      ...(language && { language }),
      ...(lat !== undefined && lat !== null && { lat }),
      ...(lon !== undefined && lon !== null && { lon }),
    };
    
    const response = await fetch(`${PAYAL_API_BASE_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Payal Chat Response:', {
      hasResponse: !!data.response,
      intent: data.intent,
      endpoint: data.endpoint_used,
      sessionId: data.session_id,
    });
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error calling Payal chat:', error);
    throw error;
  }
}

// Crop Advice
export async function payalCropAdvice({ query, lat, lon, uid, sessionId, language }) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    
    const body = {
      query,
      lat,
      lon,
      ...(uid && { uid }),
      ...(sessionId && { session_id: sessionId }),
      ...(language && { language }),
    };
    
    const response = await fetch(`${PAYAL_API_BASE_URL}/chat/crop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error calling Payal crop advice:', error);
    throw error;
  }
}

// Fertilizer Advice
export async function payalFertilizerAdvice({ query, uid, sessionId, language }) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    
    const response = await fetch(`${PAYAL_API_BASE_URL}/chat/fertilizer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        ...(uid && { uid }),
        ...(sessionId && { session_id: sessionId }),
        ...(language && { language }),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error calling Payal fertilizer advice:', error);
    throw error;
  }
}

// Weather Advice
export async function payalWeatherAdvice({ lat, lon, days = 3, uid, sessionId, language }) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    
    const response = await fetch(`${PAYAL_API_BASE_URL}/chat/weather`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lat,
        lon,
        days,
        ...(uid && { uid }),
        ...(sessionId && { session_id: sessionId }),
        ...(language && { language }),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error calling Payal weather advice:', error);
    throw error;
  }
}

// Start New Chat Session
export async function payalStartNewChat({ uid }) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(`${PAYAL_API_BASE_URL}/chat/new?uid=${uid}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error starting new Payal chat:', error);
    throw error;
  }
}

// Get Conversation History
export async function payalGetHistory({ uid, sessionId }) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    let url = `${PAYAL_API_BASE_URL}/chat/history?uid=${uid}`;
    if (sessionId) {
      url += `&session_id=${sessionId}`;
    }
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error('❌ Error getting Payal history:', error);
    throw error;
  }
}

// Payal 2.0 - Multilingual Farming Voice Assistant (LiveKit Integration)
const PAYAL_2_API_BASE_URL = 'https://theabeerrai-payal-2-0.hf.space';

// Start Payal 2.0 session and get LiveKit credentials
// Soil Health Card Upload & OCR
export async function uploadSoilHealthCard({ uri, base64, filename, farmer_ID, field_ID }) {
  try {
    const form = new FormData();
    if (uri) {
      const name = filename || uri.split('/').pop() || 'soil_health_card.jpg';
      const type = name.endsWith('.pdf') ? 'application/pdf' : 
                   name.endsWith('.png') ? 'image/png' : 'image/jpeg';
      form.append('file', { uri, name, type });
    } else if (base64) {
      form.append('file_base64', base64);
      if (filename) form.append('filename', filename);
    }
    if (farmer_ID) form.append('farmer_ID', farmer_ID);
    if (field_ID) form.append('field_ID', field_ID);
    
    const { data } = await api.post('/api/v1/soil-health-card/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return data;
  } catch (error) {
    console.error('❌ Error uploading soil health card:', error);
    throw error;
  }
}

// Extract text from Soil Health Card (OCR)
export async function extractTextFromSoilHealthCard({ fileUrl, farmer_ID, field_ID }) {
  try {
    const { data } = await api.post('/api/v1/soil-health-card/extract', {
      fileUrl,
      farmer_ID,
      field_ID,
    }, { timeout: 90000 });
    return data;
  } catch (error) {
    console.error('❌ Error extracting text from soil health card:', error);
    throw error;
  }
}

// Get nearest Kisan Seva Kendra centers
export async function getNearestKisanCenters({ lat, lon, limit = 3 }) {
  try {
    const params = { lat, lon, limit };
    const { data } = await api.get('/api/v1/kisan-seva-kendra/nearest', { params, timeout: 20000 });
    return data;
  } catch (error) {
    console.error('❌ Error getting nearest Kisan centers:', error);
    throw error;
  }
}

// Get Soil Health Card uploads history
export async function getSoilHealthCardHistory({ farmer_ID, field_ID, limit = 20 }) {
  try {
    const params = { farmer_ID };
    if (field_ID) params.field_ID = field_ID;
    if (limit) params.limit = limit;
    const { data } = await api.get('/api/v1/soil-health-card/history', { params, timeout: 20000 });
    return data;
  } catch (error) {
    console.error('❌ Error getting soil health card history:', error);
    throw error;
  }
}

// Start Payal 2.0 session and get LiveKit credentials
export async function startPayalSession({ language = 'en' } = {}) {
  try {
    console.log('🌾 Starting Payal 2.0 session...', { language, url: `${PAYAL_2_API_BASE_URL}/start` });
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await axios.post(
      `${PAYAL_2_API_BASE_URL}/start`,
      { language },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,
        timeout: 30000,
      }
    );

    clearTimeout(timeoutId);

    console.log('📡 Payal 2.0 response status:', response.status);
    console.log('✅ Payal 2.0 response data:', JSON.stringify(response.data, null, 2));

    if (!response.data) {
      throw new Error('No data received from Payal 2.0 service');
    }

    // The response should contain LiveKit credentials: { livekitUrl, token, roomName, identity }
    // If the API returns a different format, we'll handle it
    const data = response.data;
    
    if (!data.livekitUrl || !data.token || !data.roomName) {
      console.warn('⚠️ Payal 2.0 response missing LiveKit credentials:', data);
      // If the API returns status/message but not credentials, it might be a different format
      // We'll still return it and let the caller handle it
      return data;
    }

    return {
      livekitUrl: data.livekitUrl,
      token: data.token,
      roomName: data.roomName,
      identity: data.identity || `farmer-${Date.now()}`, // Use provided identity or generate one
      language: data.language || language,
      status: data.status,
      message: data.message,
    };
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - Payal 2.0 service took too long to respond');
    }
    console.error('❌ Error starting Payal 2.0 session:', error);
    const errorMessage = error.response?.data?.message || error.message || 'Failed to connect to Payal 2.0 service';
    throw new Error(errorMessage);
  }
}


