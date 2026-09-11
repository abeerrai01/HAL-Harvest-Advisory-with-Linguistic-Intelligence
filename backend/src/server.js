import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import { InferenceClient } from '@huggingface/inference';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { v2 as cloudinary } from 'cloudinary';

dotenv.config();

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin with service account
if (!admin.apps.length) {
  try {
    const serviceAccountPath = join(__dirname, '..', 'serviceAccountKey.json');
    console.log('🔍 Looking for service account at:', serviceAccountPath);
    
    // Read and parse the service account file
    const fileContent = readFileSync(serviceAccountPath, 'utf8');
    const serviceAccount = JSON.parse(fileContent);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'hal-app-41b87',
    });
    console.log('✅ Firebase Admin initialized with service account');
  } catch (error) {
    console.error('❌ Error initializing Firebase Admin:', error.message);
    console.error('Error stack:', error.stack);
    // Last resort: default credentials
    admin.initializeApp({
      projectId: 'hal-app-41b87',
    });
    console.log('⚠️  Firebase Admin initialized with default credentials (may not work)');
  }
}

const db = admin.firestore();

const app = express();
const port = process.env.PORT || 5050;

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// CORS configuration - allow all origins for development
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
// For file uploads (images/audio)
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });

// Gemini Model Configuration
const GEMINI_PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

/**
 * Robust caller for Gemini generateContent API
 * Uses the configured model (default: gemini-3.8-flash) with automatic fallback
 */
async function callGeminiGenerateContent(apiKey, payload, options = {}) {
  const modelsToTry = [
    GEMINI_PRIMARY_MODEL,
    ...GEMINI_FALLBACK_MODELS.filter((m) => m !== GEMINI_PRIMARY_MODEL),
  ];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
      const response = await axios.post(url, payload, {
        timeout: options.timeout || 30000,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      return { data: response.data, modelUsed: model };
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      const errMsg = String(err?.response?.data?.error?.message || '').toLowerCase();
      if (status === 404 || (status === 400 && (errMsg.includes('model') || errMsg.includes('not found') || errMsg.includes('invalid')))) {
        console.warn(`⚠️ Model "${model}" returned ${status}, falling back to next available model...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'hal-api' });
});

// Farmer assistant endpoint (stub)
app.post('/api/farmer-assistant', (req, res) => {
  const { query = '', language = 'en', location = 'India' } = req.body || {};
  const reply = `Received query: "${query}" (lang=${language}, location=${location}).`;
  res.json({ reply, ok: true });
});

// POST /api/v1/pest-disease/classify - Image classification via Hugging Face Inference Providers
// Accepts multipart/form-data (file field: image) or JSON with { image_base64 }
app.post('/api/v1/pest-disease/classify', upload.single('image'), async (req, res) => {
  try {
    // Read optional farmer_ID to determine language from Firestore
    const farmer_ID = req.body?.farmer_ID || req.query?.farmer_ID;
    let language = (req.body?.language && String(req.body.language)) || 'en';
    try {
      if (!req.body?.language && farmer_ID) {
        const u = await db.collection('users').doc(farmer_ID).get();
        const lang = u.exists ? (u.data()?.language || 'en') : 'en';
        language = lang;
      }
    } catch {}

    // Prepare image buffer
    let dataBuffer = null;
    let filename = 'image.jpg';
    let contentType = 'image/jpeg';
    if (req.file && req.file.buffer) {
      dataBuffer = req.file.buffer;
      filename = req.file.originalname || filename;
      contentType = req.file.mimetype || contentType;
    } else if (req.body?.image_base64) {
      const base64 = String(req.body.image_base64).replace(/^data:[^;]+;base64,/, '');
      dataBuffer = Buffer.from(base64, 'base64');
    }
    if (!dataBuffer) {
      return res.status(400).json({ ok: false, error: 'No image provided. Send multipart file "image" or JSON { image_base64 }.' });
    }

    // Call external pest/disease API
    const form = new FormData();
    form.append('file', dataBuffer, { filename, contentType, knownLength: dataBuffer.length });
    if (language) form.append('language', language);

    const url = 'https://theabeerrai-pest-hal.hf.space/predict';
    const { data } = await axios.post(url, form, {
      headers: { ...form.getHeaders() },
      timeout: 120000,
      validateStatus: s => s < 500,
    });

    if (data?.error) {
      return res.status(502).json({ ok: false, error: data.error });
    }
    return res.json({ ok: true, language, report: data });
  } catch (error) {
    const status = error?.response?.status;
    const errData = error?.response?.data;
    const msg = error?.message || 'Classification failed';
    const errorStack = error?.stack?.split('\n').slice(0, 5).join('\n') || '';
    console.error('❌ HF classification error:', status, msg);
    console.error('❌ Error details:', errData ? JSON.stringify(errData).slice(0, 500) : 'No error data');
    console.error('❌ Error stack:', errorStack);
    res.status(502).json({ 
      ok: false, 
      status, 
      error: msg, 
      details: errData || error.toString(),
      errorType: error?.constructor?.name || 'Unknown'
    });
  }
});

// POST /api/v1/stt - Speech-to-text using Google Speech-to-Text API (multilingual)
// Accepts multipart/form-data (file field: audio) or JSON { audio_base64, mime, language }
app.post('/api/v1/stt', upload.single('audio'), async (req, res) => {
  let lastError = null;
  const MAX_RETRIES = 3;
  const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB limit for Google STT
  
  try {
    const GOOGLE_STT_API_KEY = process.env.GOOGLE_STT_API_KEY || 'AIzaSyAITHpLcUN1lqYjWevqlDIjWWMeBp-vG6M';
    if (!GOOGLE_STT_API_KEY) return res.status(501).json({ error: 'GOOGLE_STT_API_KEY not configured' });

    let audioBuffer = null;
    let filename = 'audio.wav';
    let contentType = 'audio/wav';
    if (req.file && req.file.buffer) {
      audioBuffer = req.file.buffer;
      filename = req.file.originalname || filename;
      contentType = req.file.mimetype || contentType;
    } else if (req.body?.audio_base64) {
      const base64 = String(req.body.audio_base64).replace(/^data:[^;]+;base64,/, '');
      audioBuffer = Buffer.from(base64, 'base64');
      filename = req.body?.filename || filename;
      contentType = req.body?.mime || contentType;
    }
    if (!audioBuffer) return res.status(400).json({ error: 'No audio provided' });

    // Check audio size - reject if too large
    if (audioBuffer.length > MAX_AUDIO_SIZE) {
      console.warn(`⚠️ Audio too large: ${audioBuffer.length} bytes, max: ${MAX_AUDIO_SIZE}`);
      return res.status(400).json({ 
        ok: false, 
        error: `Audio file too large (${Math.round(audioBuffer.length / 1024)}KB). Maximum size is ${Math.round(MAX_AUDIO_SIZE / 1024)}KB. Please record a shorter audio.` 
      });
    }

    console.log(`🎤 Processing audio: size=${audioBuffer.length} bytes, type=${contentType}, filename=${filename}`);

    // Map language codes to Google STT language codes
    const language = req.body?.language || 'en';
    const googleLanguageMap = {
      'en': 'en-US',
      'hi': 'hi-IN',
      'mr': 'mr-IN',
      'ta': 'ta-IN',
      'te': 'te-IN',
      'kn': 'kn-IN',
      'ml': 'ml-IN',
      'gu': 'gu-IN',
      'pa': 'pa-IN',
      'bn': 'bn-IN',
      'or': 'or-IN',
    };
    const googleLanguageCode = googleLanguageMap[language] || 'en-US';

    // Detect audio format and set appropriate encoding
    // Google STT supports: LINEAR16, FLAC, MULAW, ALAW, AMR, AMR_WB, OGG_OPUS, SPEEX_WITH_HEADER_BYTE
    // For mobile recordings (M4A/AAC), we'll use LINEAR16 or let Google auto-detect
    let encoding = 'LINEAR16'; // Default
    let sampleRate = 16000; // Standard for speech
    
    // Detect encoding from file extension or content type
    const fileExt = filename.toLowerCase().split('.').pop();
    const contentTypeLower = contentType.toLowerCase();
    
    if (fileExt === 'flac' || contentTypeLower.includes('flac')) {
      encoding = 'FLAC';
    } else if (fileExt === 'm4a' || fileExt === 'aac' || contentTypeLower.includes('m4a') || contentTypeLower.includes('aac')) {
      // For M4A/AAC, we need to use LINEAR16 or convert
      // Google STT doesn't directly support M4A, so we'll use LINEAR16
      // The audio will be decoded by Google's API
      encoding = 'LINEAR16';
      sampleRate = 16000;
    } else if (fileExt === 'opus' || contentTypeLower.includes('opus')) {
      encoding = 'OGG_OPUS';
    } else if (fileExt === 'wav' || contentTypeLower.includes('wav')) {
      encoding = 'LINEAR16';
    } else {
      // Try to auto-detect - use LINEAR16 as safe default
      encoding = 'LINEAR16';
    }

    // Optimize audio configuration for better quality and noise reduction
    // Google STT automatically handles noise reduction with enhanced models
    const config = {
      encoding: encoding,
      sampleRateHertz: sampleRate,
      languageCode: googleLanguageCode,
      alternativeLanguageCodes: ['en-US', 'hi-IN'], // Fallback languages
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: false,
      enableSpokenPunctuation: false,
      enableSpokenEmojis: false,
      // Use enhanced model for better accuracy and noise reduction
      useEnhanced: true, // Enable for better noise handling and accuracy
    };
    
    // Note: For M4A/AAC files, Google STT will auto-decode them
    // The encoding field tells Google the format of the decoded audio
    // We use LINEAR16 as it's the most compatible format
    
    console.log(`🎵 Audio config: encoding=${encoding}, sampleRate=${sampleRate}Hz, language=${googleLanguageCode}`);

    // Convert audio buffer to base64 for Google STT
    const audioBase64 = audioBuffer.toString('base64');

    const audio = {
      content: audioBase64,
    };

    const requestBody = {
      config,
      audio,
    };

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`🔄 Google STT attempt ${attempt}/${MAX_RETRIES}: language=${googleLanguageCode}, size=${audioBuffer.length} bytes`);

        const { data } = await axios.post(
          `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_STT_API_KEY}`,
          requestBody,
          {
            headers: { 
              'Content-Type': 'application/json',
              'Connection': 'keep-alive',
            },
            timeout: 45000, // Reduced timeout to fail faster
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            // Add retry configuration
            validateStatus: (status) => status < 500, // Don't throw on 4xx errors
          }
        );

        const transcript = data?.results?.[0]?.alternatives?.[0]?.transcript || '';
        const confidence = data?.results?.[0]?.alternatives?.[0]?.confidence || 0;
        
        console.log(`✅ Google STT success: transcript length=${transcript.length}, confidence=${confidence.toFixed(2)}`);
        
        if (transcript) {
          return res.json({ 
            ok: true, 
            text: transcript, 
            confidence: confidence,
            raw: data 
          });
        } else {
          // If no transcript but no error, return empty (might be silence/no speech)
          console.warn('⚠️ No transcript returned, but no error');
          return res.json({ 
            ok: true, 
            text: '', 
            confidence: 0,
            warning: 'No speech detected in audio',
            raw: data 
          });
        }
      } catch (error) {
        lastError = error;
        const isConnectionError = error.code === 'ECONNRESET' || 
                                  error.code === 'ETIMEDOUT' || 
                                  error.code === 'ECONNREFUSED' ||
                                  error.message?.includes('timeout') ||
                                  error.message?.includes('ECONNRESET');
        
        if (isConnectionError && attempt < MAX_RETRIES) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
          console.warn(`⚠️ Connection error on attempt ${attempt}, retrying in ${backoffDelay}ms...`, error.message);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }
        
        // If it's not a connection error or we've exhausted retries, throw
        if (!isConnectionError || attempt === MAX_RETRIES) {
          throw error;
        }
      }
    }

    // Should not reach here, but just in case
    throw lastError || new Error('STT failed after retries');
  } catch (error) {
    const status = error?.response?.status;
    const errorCode = error?.code;
    const errorMessage = error?.message || 'STT failed';
    
    console.error('❌ Google STT error:', {
      status,
      code: errorCode,
      message: errorMessage,
      responseData: error?.response?.data,
    });

    // Provide user-friendly error messages
    let userMessage = 'Speech recognition failed';
    if (errorCode === 'ECONNRESET' || errorMessage.includes('ECONNRESET')) {
      userMessage = 'Connection reset. Please try recording again with a shorter audio clip.';
    } else if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout')) {
      userMessage = 'Request timeout. Please try with a shorter audio recording.';
    } else if (status === 400) {
      userMessage = error?.response?.data?.error?.message || 'Invalid audio format. Please try again.';
    } else if (status === 403) {
      userMessage = 'API key permission denied.';
    } else if (status === 429) {
      userMessage = 'Rate limit exceeded. Please wait a moment and try again.';
    }

    res.status(status && status < 500 ? status : 502).json({ 
      ok: false, 
      error: userMessage,
      details: errorMessage,
      code: errorCode,
    });
  }
});

// POST /api/v1/pd-recommendation - Gemini recommendation based on disease report
app.post('/api/v1/pd-recommendation', async (req, res) => {
  try {
    const { report, language = 'en' } = req.body || {};
    if (!report || typeof report !== 'object') return res.status(400).json({ ok: false, error: 'report object required' });
    const GEMINI_KEY = process.env.GEMINI_SOIL_API_KEY || process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) return res.status(501).json({ ok: false, error: 'Gemini key not configured' });
    const langName = language === 'hi' ? 'Hindi' : language === 'mr' ? 'Marathi' : language === 'ta' ? 'Tamil' : language === 'bn' ? 'Bengali' : language === 'te' ? 'Telugu' : language === 'gu' ? 'Gujarati' : language === 'pa' ? 'Punjabi' : language === 'kn' ? 'Kannada' : language === 'ml' ? 'Malayalam' : 'English';
    const title = report['Report Title'];
    const disease = report['Disease Name'];
    const conf = report['Model Confidence'];
    const detailed = report['Detailed Report'];
    const others = Array.isArray(report['Other Possible Diseases']) ? report['Other Possible Diseases'].slice(0,3).map(x => `${x.label} (${Math.round((x.confidence||0)*100)}%)`).join(', ') : '';
    const prompt = `You are an agriculture plant disease advisor. Create a concise, actionable recommendation in ${langName}.
INPUT:
Title: ${title || ''}
Disease: ${disease || ''}
Model confidence: ${conf || ''}
Other possibilities: ${others}
Detailed:
${detailed || ''}

OUTPUT JSON ONLY with keys: { "summary": "", "immediate_actions": [""], "organic_solutions": [""], "preventive_measures": [""], "warning": "" }`;
    console.log('🤖 PD RECO prompt bytes:', prompt.length);
    const { data: aiData } = await callGeminiGenerateContent(GEMINI_KEY, { contents: [{ parts: [{ text: prompt }] }] }, { timeout: 30000 });
    const text = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const m = String(text).match(/\{[\s\S]*\}/);
    const reco = JSON.parse(m ? m[0] : text);
    return res.json({ ok: true, recommendation: reco, language });
  } catch (e) {
    console.error('❌ PD recommendation failed:', e?.message);
    res.status(502).json({ ok: false, error: e?.message || 'failed' });
  }
});

// POST /api/v1/pd-history - Save detection to Firestore
app.post('/api/v1/pd-history', async (req, res) => {
  try {
    const { farmer_ID, report } = req.body || {};
    if (!farmer_ID || !report) return res.status(400).json({ ok: false, error: 'farmer_ID and report required' });
    const ref = db.collection('users').doc(farmer_ID).collection('pd_history').doc();
    const item = { id: ref.id, report, created_at: admin.firestore.FieldValue.serverTimestamp() };
    await ref.set(item);
    return res.json({ ok: true, item: { ...item, created_at: new Date().toISOString() } });
  } catch (e) {
    console.error('❌ Save PD history failed:', e?.message);
    res.status(502).json({ ok: false, error: e?.message || 'failed' });
  }
});

// GET /api/v1/pd-history?farmer_ID= - List detections
app.get('/api/v1/pd-history', async (req, res) => {
  try {
    const { farmer_ID, limit = 20 } = req.query || {};
    if (!farmer_ID) return res.status(400).json({ ok: false, error: 'farmer_ID required' });
    const snap = await db.collection('users').doc(farmer_ID).collection('pd_history').orderBy('created_at', 'desc').limit(Number(limit)||20).get();
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data(), created_at: d.data()?.created_at?.toDate?.()?.toISOString?.() || null }));
    return res.json({ ok: true, items });
  } catch (e) {
    console.error('❌ List PD history failed:', e?.message);
    res.status(502).json({ ok: false, error: e?.message || 'failed' });
  }
});
// POST /api/v1/weather-advisory - Get dynamic weather + AI advisory for a lat/lon
app.post('/api/v1/weather-advisory', async (req, res) => {
  try {
    const { lat, lon, language = 'en' } = req.body || {};
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ ok: false, error: 'lat and lon are required numbers' });
    }
    const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
    if (!WEATHER_API_KEY) return res.status(501).json({ ok: false, error: 'WEATHER_API_KEY not configured' });

    // Fetch current + forecast from OpenWeather (supports 2.5, 3.0, and 4.0 OneCall timeline)
    const units = 'metric';
    const WEATHER_API_URL = process.env.WEATHER_API_URL || 'https://api.openweathermap.org/data/2.5';
    const isV4 = WEATHER_API_URL.includes('4.0');
    const oneCallEndpoint = isV4 ? '/onecall/timeline/1day' : '/onecall';
    const oneCallUrl = isV4
      ? `${WEATHER_API_URL.replace(/\/$/, '')}${oneCallEndpoint}?lat=${lat}&lon=${lon}&cnt=10&units=${units}&appid=${WEATHER_API_KEY}`
      : `${WEATHER_API_URL.replace(/\/$/, '')}${oneCallEndpoint}?lat=${lat}&lon=${lon}&units=${units}&exclude=minutely&appid=${WEATHER_API_KEY}`;
    const currentUrl = `${WEATHER_API_URL.replace(/\/$/, '')}/weather?lat=${lat}&lon=${lon}&units=${units}&appid=${WEATHER_API_KEY}`;

    console.log('🌦️ Weather API request:', { lat, lon, units, WEATHER_API_URL, oneCallUrl, currentUrl });
    const [oneResp, curResp] = await Promise.all([
      axios.get(oneCallUrl, { timeout: 20000, validateStatus: s => s < 500 }).catch(e => ({ __err: e, data: null, status: e?.response?.status })),
      axios.get(currentUrl, { timeout: 20000, validateStatus: s => s < 500 }).catch(e => ({ __err: e, data: null, status: e?.response?.status }))
    ]);
    if (oneResp?.__err) console.error('❌ onecall error:', oneResp.__err?.message, oneResp.__err?.response?.data);
    if (curResp?.__err) console.error('❌ weather error:', curResp.__err?.message, curResp.__err?.response?.data);
    let one = oneResp?.data || {};
    const cur = curResp?.data || {};
    console.log('✅ Weather API ok:', {
      have_current: !!cur?.main,
      have_hourly: Array.isArray(one?.hourly) ? one.hourly.length : 0,
      have_daily: Array.isArray(one?.daily) ? one.daily.length : 0,
      have_timeline_data: Array.isArray(one?.data) ? one.data.length : 0,
      sample_current: cur?.weather?.[0]?.description,
    });

    // Shape a compact weather summary for prompting
    const now = {
      temp: cur?.main?.temp,
      feels_like: cur?.main?.feels_like,
      humidity: cur?.main?.humidity,
      wind_speed: cur?.wind?.speed,
      weather: cur?.weather?.[0]?.description,
      rain_1h: cur?.rain?.['1h'] || 0,
    };
    console.log('🧮 NOW shaped:', now);
    let next48h = (one?.hourly || []).slice(0, 16).map(h => ({
      dt: h.dt,
      temp: h.temp,
      pop: h.pop,
      rain: h.rain?.['1h'] || 0,
      wind_speed: h.wind_speed,
      weather: h.weather?.[0]?.description,
    }));
    console.log('🧮 next48h size:', next48h.length, 'sample:', next48h[0]);
    let next7d = (one?.daily || []).slice(0, 7).map(d => ({
      dt: d.dt,
      temp_min: d.temp?.min,
      temp_max: d.temp?.max,
      pop: d.pop,
      rain: d.rain || 0,
      weather: d.weather?.[0]?.description,
    }));

    // If OpenWeather OneCall 4.0 data array is returned
    if ((!next7d || next7d.length === 0) && Array.isArray(one?.data) && one.data.length > 0) {
      next7d = one.data.slice(0, 7).map(d => ({
        dt: d.dt,
        temp_min: d.temp?.min ?? d.temp?.night ?? d.temp,
        temp_max: d.temp?.max ?? d.temp?.day ?? d.temp,
        pop: d.pop || 0,
        rain: d.rain || 0,
        weather: d.weather?.[0]?.description,
      }));
    }
    console.log('🧮 next7d size:', next7d.length, 'sample:', next7d[0]);

    // Fallback if One Call returned 401/empty: use 5-day/3-hour forecast to derive
    if ((!Array.isArray(one?.hourly) || one.hourly.length === 0) || oneResp?.status === 401 || oneResp?.__err) {
      try {
        const forecastUrl = `${WEATHER_API_URL.replace(/\/$/, '')}/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${WEATHER_API_KEY}`;
        console.log('↩️ Fallback to /forecast:', forecastUrl);
        const f = await axios.get(forecastUrl, { timeout: 20000, validateStatus: s => s < 500 });
        const list = Array.isArray(f?.data?.list) ? f.data.list : [];
        // Next 48h from 3h steps (max 16 items)
        next48h = list.slice(0, 16).map(x => ({
          dt: x.dt,
          temp: x.main?.temp,
          pop: x.pop,
          rain: (x.rain?.['3h'] || 0) / 3, // normalize to per-hour approx
          wind_speed: x.wind?.speed,
          weather: x.weather?.[0]?.description,
        }));
        // Aggregate per day
        const dayBuckets = {};
        for (const x of list) {
          const day = new Date(x.dt * 1000).toISOString().slice(0,10);
          const b = dayBuckets[day] || { min: Infinity, max: -Infinity, pop: 0, rain: 0, count: 0, weather: x.weather?.[0]?.description };
          b.min = Math.min(b.min, Number(x.main?.temp_min ?? x.main?.temp));
          b.max = Math.max(b.max, Number(x.main?.temp_max ?? x.main?.temp));
          b.pop += Number(x.pop || 0);
          b.rain += Number(x.rain?.['3h'] || 0);
          b.count += 1;
          dayBuckets[day] = b;
        }
        next7d = Object.entries(dayBuckets).slice(0,7).map(([iso, b]) => ({
          dt: Date.parse(iso)/1000,
          temp_min: isFinite(b.min) ? b.min : null,
          temp_max: isFinite(b.max) ? b.max : null,
          pop: b.count ? b.pop / b.count : 0,
          rain: b.rain,
          weather: b.weather,
        }));
        console.log('✅ Fallback built: hourly', next48h.length, 'daily', next7d.length);
      } catch (fe) {
        console.error('❌ Forecast fallback failed:', fe?.message, fe?.response?.data);
      }
    }

    // Build prompt for Gemini (soil key is suitable)
    const GEMINI_SOIL_API_KEY = process.env.GEMINI_SOIL_API_KEY;
    if (!GEMINI_SOIL_API_KEY) return res.status(501).json({ ok: false, error: 'GEMINI_SOIL_API_KEY not configured' });
    const langName = language === 'hi' ? 'Hindi' : 'English';
    const prompt = `You are an agricultural weather advisor for smallholder farmers in India. Using the weather data provided, create:
1) A concise risk summary for the next 48 hours (rain, wind, heat, cold, storm) in ${langName}
2) Simple actions to protect crops and plan field work (organic-first)
3) A 7-day plan highlighting risky days and irrigation/fertilizer scheduling windows
Return ONLY JSON.

CURRENT:
${JSON.stringify(now)}

NEXT_48H:
${JSON.stringify(next48h)}

NEXT_7D:
${JSON.stringify(next7d)}

JSON SHAPE:
{
  "risk_summary": "",
  "actions_now": [""],
  "next_48h": [{"time": "ISO", "risk": "", "advice": ""}],
  "week_plan": [{"day": "ISO", "summary": "", "actions": [""]}]
}`;

    console.log('🧠 Gemini request bytes:', prompt.length);
    // Simple retry on timeout up to 2 times
    let advisory = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { data: aiData } = await callGeminiGenerateContent(
          GEMINI_SOIL_API_KEY,
          { contents: [{ parts: [{ text: prompt }] }] },
          { timeout: 45000 }
        );
        const txt = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        console.log('🧠 Gemini response preview:', String(txt).slice(0, 200));
        const m = String(txt).match(/\{[\s\S]*\}/);
        advisory = JSON.parse(m ? m[0] : txt);
        break;
      } catch (e) {
        lastErr = e;
        const to = 1500 * attempt;
        console.warn(`⚠️ Gemini attempt ${attempt} failed:`, e?.message);
        await new Promise(r => setTimeout(r, to));
      }
    }
    if (!advisory) {
      console.error('❌ Gemini failed, using heuristic advisory. Last error:', lastErr?.message);
      // Heuristic fallback advisory
      const heavyRain = next48h.some(h => (h.pop || 0) > 0.6 || (h.rain || 0) > 3);
      const windy = next48h.some(h => (h.wind_speed || 0) > 10);
      advisory = {
        risk_summary: heavyRain ? 'High chance of rain soon; protect inputs and plan drainage.' : (windy ? 'Gusty winds expected; secure trellises and protect seedlings.' : 'Low immediate weather risk.'),
        actions_now: [
          heavyRain ? 'Avoid spraying before rain; shift irrigation to after rainfall.' : 'Irrigate in morning/evening as needed; avoid midday heat.',
          'Check field drainage; keep bunds clear.'
        ],
        next_48h: next48h.slice(0,6).map(h => ({
          time: new Date((h.dt||0)*1000).toISOString(),
          risk: (h.pop||0) > 0.6 ? 'rain' : (h.wind_speed||0) > 10 ? 'wind' : 'low',
          advice: (h.pop||0) > 0.6 ? 'Delay fertilizer/pesticide application until after showers.' : 'Proceed with planned activities.'
        })),
        week_plan: next7d.slice(0,5).map(d => ({
          day: new Date((d.dt||0)*1000).toISOString(),
          summary: (d.rain||0) > 5 ? 'Rain likely' : 'Mostly dry',
          actions: [(d.rain||0) > 5 ? 'Plan irrigation after rain; avoid waterlogging.' : 'Schedule irrigation and weeding.']
        }))
      };
    }
    console.log('✅ Advisory keys:', Object.keys(advisory));

    res.json({ ok: true, weather: { now, next48h, next7d }, advisory });
  } catch (e) {
    console.error('❌ Weather advisory failed:', e?.message);
    res.status(502).json({ ok: false, error: e?.message || 'Weather advisory failed' });
  }
});

// POST /api/v1/disease-chat - Conversational Q&A about detected disease (Gemini)
// Body: { disease_label, context?, question, history?[], language? }
app.post('/api/v1/disease-chat', async (req, res) => {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(501).json({ error: 'GEMINI_API_KEY not configured in environment variables' });
    }
    const { disease_label, question, context = '', history = [], language = 'en' } = req.body || {};
    if (!disease_label || !question) return res.status(400).json({ error: 'disease_label and question are required' });

    const languageName = language === 'hi' ? 'Hindi' : language === 'en' ? 'English' : 'English';
    const historyText = Array.isArray(history)
      ? history.map((h) => `${h.role || 'user'}: ${h.text || ''}`).join('\n')
      : '';

    const prompt = `You are an agriculture plant pathology expert. Answer in ${languageName}.
Detected disease: ${disease_label}
Field/context: ${context}
Conversation so far:\n${historyText}

User question: ${question}

Respond with:
- brief diagnosis confirmation
- immediate actions (safe, organic-first)
- prevention tips
- if severe: escalation advice
Keep it concise and actionable for smallholder farmers.`;

    const { data } = await callGeminiGenerateContent(
      GEMINI_API_KEY,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: 30000 }
    );
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ ok: true, answer: text });
  } catch (error) {
    const msg = error?.response?.data || error?.message || 'Chat failed';
    console.error('❌ Disease chat error:', msg);
    res.status(502).json({ ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 500) });
  }
});

// Fields endpoints - Firestore integration

// GET /api/v1/fields - Get all fields for a farmer
app.get('/api/v1/fields', async (req, res) => {
  try {
    const { farmer_ID } = req.query;
    
    if (!farmer_ID) {
      return res.status(400).json({ error: 'farmer_ID is required' });
    }
    
    const fieldsRef = db.collection('users').doc(farmer_ID).collection('fields');
    const snapshot = await fieldsRef.get();
    
    const fields = [];
    snapshot.forEach((doc) => {
      fields.push({
        id: doc.id, // field_name is the document ID
        ...doc.data(),
      });
    });
    
    res.json({ fields, ok: true });
  } catch (error) {
    console.error('Error fetching fields:', error);
    res.status(500).json({ error: 'Failed to fetch fields', message: error.message });
  }
});

// POST /api/v1/fields - Create a new field
app.post('/api/v1/fields', async (req, res) => {
  try {
    const { farmer_ID, field_name, geometry } = req.body;
    
    console.log('📥 Received field save request:', {
      farmer_ID,
      field_name,
      geometryPoints: geometry?.length,
      geometry: geometry,
    });
    
    // Validate: require exactly 4 points
    if (!farmer_ID || !field_name || !geometry || !Array.isArray(geometry) || geometry.length !== 4) {
      console.error('❌ Validation failed:', {
        hasFarmerID: !!farmer_ID,
        hasFieldName: !!field_name,
        hasGeometry: !!geometry,
        isArray: Array.isArray(geometry),
        length: geometry?.length,
      });
      return res.status(400).json({ 
        error: 'farmer_ID, field_name, and geometry (exactly 4 points) are required',
        received: {
          farmer_ID: !!farmer_ID,
          field_name: !!field_name,
          geometry: Array.isArray(geometry) ? geometry.length : 'not an array',
        }
      });
    }
    
    // Convert geometry array to lat1, lon1, lat2, lon2, lat3, lon3, lat4, lon4 schema
    const fieldData = {
      lat1: geometry[0][0],
      lon1: geometry[0][1],
      lat2: geometry[1][0],
      lon2: geometry[1][1],
      lat3: geometry[2][0],
      lon3: geometry[2][1],
      lat4: geometry[3][0],
      lon4: geometry[3][1],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    console.log('💾 Saving to Firestore:', {
      collection: `users/${farmer_ID}/fields`,
      documentId: field_name.trim(),
      data: fieldData,
    });
    
    // Save to Firestore: users/{farmer_ID}/fields/{field_name}
    const fieldRef = db.collection('users').doc(farmer_ID).collection('fields').doc(field_name.trim());
    await fieldRef.set(fieldData);
    
    console.log('✅ Field saved successfully to Firestore');
    
    res.status(201).json({ 
      field: {
        id: field_name.trim(),
        field_name: field_name.trim(),
        ...fieldData,
        createdAt: new Date().toISOString(),
      },
      ok: true 
    });
  } catch (error) {
    console.error('❌ Error saving field:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ 
      error: 'Failed to save field', 
      message: error.message,
      code: error.code || 'UNKNOWN_ERROR',
    });
  }
});

// Jobs endpoints - Asynchronous job queuing

// POST /api/v1/jobs - Create a new analysis job
app.post('/api/v1/jobs', async (req, res) => {
  try {
    const { field_ID, job_type = 'CROP_HEALTH_ANALYSIS', farmer_ID, advisory_params = null } = req.body;
    
    console.log('📥 Received job request:', { field_ID, job_type, farmer_ID, hasAdvisoryParams: !!advisory_params });
    
    // Validate field_ID
    if (!field_ID || typeof field_ID !== 'string' || field_ID.trim().length === 0) {
      return res.status(400).json({ 
        error: 'field_ID is required and must be a non-empty string',
        received: field_ID,
      });
    }
    
    // Validate farmer_ID
    if (!farmer_ID || typeof farmer_ID !== 'string' || farmer_ID.trim().length === 0) {
      return res.status(400).json({ 
        error: 'farmer_ID (user UID) is required and must be a non-empty string',
        received: farmer_ID,
      });
    }
    
    // Clean and validate field_ID format
    const cleanFieldID = field_ID.trim();
    
    // Verify field exists before creating job
    try {
      const fieldRef = db.collection('users').doc(farmer_ID).collection('fields').doc(cleanFieldID);
      const fieldDoc = await fieldRef.get();
      
      if (!fieldDoc.exists) {
        return res.status(404).json({
          error: `Field "${cleanFieldID}" not found for this user`,
          field_ID: cleanFieldID,
          farmer_ID,
        });
      }
      
      console.log(`✅ Field "${cleanFieldID}" exists for farmer ${farmer_ID}`);
    } catch (validationError) {
      console.error('❌ Error validating field:', validationError);
      return res.status(400).json({
        error: 'Invalid field_ID format',
        message: validationError.message,
        field_ID: cleanFieldID,
      });
    }
    
    // Generate unique job ID
    const job_ID = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Prepare job data with UID (use cleaned field_ID)
    const jobData = {
      job_ID,
      field_ID: cleanFieldID, // Use cleaned/validated field_ID
      farmer_ID, // Add user UID to job
      job_type,
      status: 'PENDING',
      requested_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    // Store advisory_params if provided (district, soil type, season, irrigation, etc.)
    if (advisory_params && typeof advisory_params === 'object') {
      jobData.advisory_params = advisory_params;
      console.log('📋 Storing advisory params in job:', {
        state: advisory_params.state,
        district: advisory_params.district,
        soil_type: advisory_params.soil_type,
        season: advisory_params.season,
        has_irrigation: !!advisory_params.irrigation_days_ago,
        has_manual_npk: !!advisory_params.manual_npk,
        has_soil_card: !!advisory_params.soil_health_card_text,
      });
    }
    
    // Save job to main jobs collection: jobs/{job_ID}
    const jobRef = db.collection('jobs').doc(job_ID);
    await jobRef.set(jobData);
    
    // Also save copy in user's subcollection: users/{farmer_ID}/jobs/{job_ID}
    const userJobRef = db.collection('users').doc(farmer_ID).collection('jobs').doc(job_ID);
    await userJobRef.set(jobData);
    
    console.log('✅ Job queued successfully:', { 
      job_ID, 
      field_ID: cleanFieldID, 
      farmer_ID,
      status: 'PENDING',
      savedTo: ['jobs collection', `users/${farmer_ID}/jobs subcollection`]
    });
    
    // Return 202 Accepted - job is queued, processing will happen asynchronously
    res.status(202).json({
      status: 202,
      message: 'Analysis started! We will notify you when it is ready.',
      job_id: job_ID,
    });
  } catch (error) {
    console.error('❌ Error creating job:', error);
    res.status(500).json({ 
      error: 'Failed to create job', 
      message: error.message,
      code: error.code || 'UNKNOWN_ERROR',
    });
  }
});

// GET /api/v1/jobs/{job_id} - Get job status
app.get('/api/v1/jobs/:job_id', async (req, res) => {
  try {
    const { job_id } = req.params;
    
    const jobRef = db.collection('jobs').doc(job_id);
    const jobDoc = await jobRef.get();
    
    if (!jobDoc.exists) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const jobData = jobDoc.data();
    res.json({ job: jobData, ok: true });
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ error: 'Failed to fetch job', message: error.message });
  }
});

// GET /api/v1/jobs - Get all jobs for a field or user
app.get('/api/v1/jobs', async (req, res) => {
  try {
    const { field_ID, farmer_ID } = req.query;
    
    // If farmer_ID provided, fetch from user's subcollection (faster)
    if (farmer_ID) {
      const userJobsRef = db.collection('users').doc(farmer_ID).collection('jobs');
      let query = userJobsRef;
      
      // If field_ID also provided, filter by field first, then order
      if (field_ID) {
        query = query.where('field_ID', '==', field_ID);
      }
      
      // Order after filtering (Firestore requires index for where + orderBy combo)
      let snapshot;
      try {
        snapshot = await query.orderBy('requested_at', 'desc').get();
      } catch (orderError) {
        // Fallback: get all and sort in memory
        console.warn('OrderBy failed, sorting in memory:', orderError.message);
        snapshot = await query.get();
      }
      
      const jobs = [];
      snapshot.forEach((doc) => {
        jobs.push({
          id: doc.id,
          ...doc.data(),
        });
      });
      
      // Sort in memory if orderBy wasn't used
      if (field_ID) {
        jobs.sort((a, b) => {
          const aTime = a.requested_at?.toMillis?.() || a.requested_at || 0;
          const bTime = b.requested_at?.toMillis?.() || b.requested_at || 0;
          return bTime - aTime;
        });
      }
      
      return res.json({ jobs, ok: true });
    }
    
    // Otherwise, fetch from main jobs collection by field_ID
    if (!field_ID) {
      return res.status(400).json({ error: 'field_ID or farmer_ID is required' });
    }
    
    const jobsRef = db.collection('jobs').where('field_ID', '==', field_ID);
    let snapshot;
    try {
      snapshot = await jobsRef.orderBy('requested_at', 'desc').get();
    } catch (orderError) {
      // Fallback: get all and sort in memory
      console.warn('OrderBy failed, sorting in memory:', orderError.message);
      snapshot = await jobsRef.get();
    }
    
    const jobs = [];
    snapshot.forEach((doc) => {
      jobs.push({
        id: doc.id,
        ...doc.data(),
      });
    });
    
    // Sort in memory if orderBy wasn't used
    jobs.sort((a, b) => {
      const aTime = a.requested_at?.toMillis?.() || a.requested_at || 0;
      const bTime = b.requested_at?.toMillis?.() || b.requested_at || 0;
      return bTime - aTime;
    });
    
    res.json({ jobs, ok: true });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs', message: error.message });
  }
});

// POST /api/v1/ai-recommendations - Generate AI recommendations using Gemini
app.post('/api/v1/ai-recommendations', async (req, res) => {
  try {
    const { 
      reportData, 
      farmer_ID, 
      field_ID, 
      language = 'en', 
      current_crop: currentCrop, 
      soil_health_card_text: soilHealthCardText,
      advisory_params: advisoryParams,
      state,
      district,
      soil_type,
      season,
      soil_health_method,
      manual_npk,
      irrigation_days_ago,
    } = req.body;
    
    // Extract irrigation_days_ago and crop_sowing_date from advisory_params if not directly provided
    const irrigationDaysAgo = irrigation_days_ago || advisoryParams?.irrigation_days_ago || null;
    const cropSowingDate = advisoryParams?.crop_sowing_date || null;
    
    if (!reportData || !farmer_ID || !field_ID) {
      return res.status(400).json({ error: 'reportData, farmer_ID, and field_ID are required' });
    }
    
    // Fetch user language if not provided
    let userLanguage = language;
    if (!userLanguage || userLanguage === 'en') {
      try {
        const userDoc = await db.collection('users').doc(farmer_ID).get();
        if (userDoc.exists) {
          userLanguage = userDoc.data().language || 'en';
        }
      } catch (error) {
        console.warn('Could not fetch user language, using default:', error.message);
      }
    }
    
    console.log('🤖 Generating AI recommendations for:', { field_ID, farmer_ID, language: userLanguage, currentCrop: currentCrop || null });
    console.log('📊 Report Data Summary:', {
      has_ndvi: !!reportData.ndvi_analysis,
      ndvi_value: reportData.ndvi_analysis?.average_ndvi,
      health_score: reportData.ndvi_analysis?.health_score,
      weather_days: reportData.weather_forecast?.length || 0,
      has_anomalies: !!reportData.anomalies,
      field_area: reportData.field_area,
      field_location: reportData.field_location,
    });

    // Fetch SoilGrids data for soil health if location is available
    let soilData = null;
    try {
      const lat = reportData.field_location?.lat;
      const lon = reportData.field_location?.lon;
      if (typeof lat === 'number' && typeof lon === 'number') {
        console.log('🌱 Fetching SoilGrids data...', { lat, lon });
        const soilUrl = `https://rest.isric.org/soilgrids/v2.0/properties/query?lat=${lat}&lon=${lon}&property=phh2o&property=clay&property=sand&property=silt&property=soc&depth=0-5cm&value=mean`;
        const soilResp = await axios.get(soilUrl, { timeout: 8000 });
        if (soilResp.data?.properties) {
          const props = soilResp.data.properties;
          // Extract mean values where available
          const extract = (key) => {
            const v = props?.[key]?.values?.[0]?.value; // first depth band mean
            return typeof v === 'number' ? v : null;
          };
          soilData = {
            ph: extract('phh2o'),
            clay_percent: extract('clay'),
            sand_percent: extract('sand'),
            silt_percent: extract('silt'),
            soil_organic_carbon: extract('soc'),
            depth: '0-5cm',
            provider: 'SoilGrids v2.0'
          };
          console.log('✅ SoilGrids fetched:', soilData);
        }
      }
    } catch (soilErr) {
      console.warn('⚠️  SoilGrids fetch failed:', soilErr.message);
    }

    // Decide advisory mode based on NDVI and user-provided current crop
    const ndvi = reportData.ndvi_analysis?.average_ndvi;
    const NDVI_THRESHOLD = 0.5; // below this, assume field likely fallow; >= 0.5, always ask for current crop
    let advisoryMode = 'ask_current_crop';
    if (currentCrop) {
      advisoryMode = 'current_crop';
    } else if (typeof ndvi === 'number') {
      if (ndvi < NDVI_THRESHOLD) advisoryMode = 'no_crop';
      else advisoryMode = 'ask_current_crop'; // NDVI >= 0.5: always ask for current crop
    }
    
    // Gemini API endpoint
    // Try different API versions and model names
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(501).json({ error: 'GEMINI_API_KEY not configured in environment variables' });
    }
    // Default models to try if ListModels doesn't work
    const DEFAULT_GEMINI_MODELS = [
      process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      'gemini-2.5-flash',   // Fast & capable
      'gemini-2.0-flash',   // Fast
      'gemini-2.5-pro',     // More capable
      'gemini-1.5-flash',   // Fallback
      'gemini-1.5-pro',     // Fallback
      'gemini-pro',         // Legacy fallback
    ];
    const API_VERSIONS = ['v1', 'v1beta']; // Try v1 first (newer), then v1beta
    
    // Determine language name for prompt
    const languageName = userLanguage === 'hi' ? 'Hindi' : 
                         userLanguage === 'en' ? 'English' :
                         userLanguage === 'te' ? 'Telugu' :
                         userLanguage === 'ta' ? 'Tamil' :
                         userLanguage === 'kn' ? 'Kannada' :
                         userLanguage === 'mr' ? 'Marathi' :
                         userLanguage === 'gu' ? 'Gujarati' :
                         userLanguage === 'ml' ? 'Malayalam' :
                         userLanguage === 'bn' ? 'Bengali' :
                         userLanguage === 'pa' ? 'Punjabi' :
                         userLanguage === 'or' ? 'Odia' :
                         userLanguage === 'as' ? 'Assamese' :
                         userLanguage === 'ur' ? 'Urdu' :
                         'English'; // Default fallback
    
    // Calculate days since sowing if provided
    const daysSinceSowing = cropSowingDate ? Math.floor((new Date() - new Date(cropSowingDate)) / (1000 * 60 * 60 * 24)) : null;
    const isCurrentCropMode = advisoryMode === 'current_crop' && currentCrop;
    
    // Build comprehensive prompt with all available data
    // Add Uttarakhand-specific context if provided
    const stateContext = state === 'Uttarakhand' ? `
STATE CONTEXT: UTTARAKHAND (Dev Bhoomi - God's Land)
- Formed: 9th November 2000 as the 27th State of India
- Location: Foothills of the Himalayan mountain ranges
- Climate: Varies from hot and moist sub-tropical in the south to cold alpine in the north
- Agro-climatic zones: Outer Himalayas (500-1250m), Lesser Himalayas (1250-2750m), Great Himalayas (2750-4500m), Trans Himalayas (4500m+)
- Districts: ${district ? `Current district: ${district}` : 'Multiple districts'}
- Soil Type: ${soil_type || 'Various soil types based on district'}
- Current Season: ${season || 'Based on current date'}
- Major Crops: Kharif (Paddy, Maize, Urd, Tur, Mung, Groundnut, Soybean), Rabi (Wheat, Barley, Gram, Pea, Lentil, Mustard, Linseed), Zaid (Summer crops)
- Special Features: Rich in biodiversity with 175 rare species of aromatic & medicinal plants, Char-dhams (Badrinath, Kedarnath, Gangotri, Yamunotri)
- Agricultural Focus: Horticulture, floriculture, organic farming, and traditional hill agriculture

` : '';
    
    const prompt = `You are an expert agricultural advisor specialized in ${state === 'Uttarakhand' ? 'Uttarakhand (Dev Bhoomi)' : 'Indian'} agriculture. Analyze the following field data and provide comprehensive crop advisory recommendations in ${languageName}.
${stateContext}

FIELD DATA:
- Field ID: ${field_ID}
- Location: Latitude ${reportData.field_location?.lat || 'N/A'}, Longitude ${reportData.field_location?.lon || 'N/A'}
- Field Area: ${reportData.field_area || 'N/A'} hectares

SOIL HEALTH (SoilGrids):
${soilData ? JSON.stringify(soilData, null, 2) : 'N/A'}
${soilHealthCardText ? `\nSOIL HEALTH CARD DATA (Extracted Text):\n${soilHealthCardText}\n` : ''}
${manual_npk && manual_npk.nitrogen ? `\nMANUAL SOIL NUTRIENTS (User Provided):\n- Nitrogen (N): ${manual_npk.nitrogen}%\n- Phosphorus (P): ${manual_npk.phosphorus || 'N/A'}%\n- Potassium (K): ${manual_npk.potassium || 'N/A'}%\n` : ''}

SATELLITE DATA (NDVI Analysis):
- Average NDVI: ${reportData.ndvi_analysis?.average_ndvi || 'N/A'}
- Health Score: ${reportData.ndvi_analysis?.health_score || 'N/A'}/100
- Satellite Image Date: ${reportData.ndvi_analysis?.timestamp || 'N/A'}
- Overall Health Status: ${reportData.summary?.overall_health || 'N/A'}

WEATHER FORECAST (5-day):
${reportData.weather_forecast ? JSON.stringify(reportData.weather_forecast, null, 2) : 'N/A'}

ANOMALIES DETECTED:
${reportData.anomalies ? JSON.stringify(reportData.anomalies, null, 2) : 'N/A'}

ADVISORY MODE:
- Mode: ${advisoryMode}
- NDVI Value: ${ndvi !== null && ndvi !== undefined ? ndvi.toFixed(3) : 'N/A'}${ndvi !== null && ndvi < 0.5 ? ' (Low NDVI - field may be fallow or crop in very early stage)' : ndvi !== null && ndvi >= 0.5 ? ' (Good vegetation detected)' : ''}
- Current Crop: ${currentCrop || 'N/A'}${currentCrop && ndvi !== null && ndvi < 0.5 ? ' (Note: Crop provided but NDVI is low - crop may be in very early stage or recently sown)' : ''}
${cropSowingDate ? `- Crop Sowing Date: ${new Date(cropSowingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} (CRITICAL: Calculate crop growth stage based on sowing date. Provide stage-specific guidance for current growth phase, including days since sowing, expected growth milestones, and stage-appropriate recommendations.)` : ''}
- Season: ${season || 'Auto-detected based on date'}
${district ? `- District: ${district}` : ''}
${soil_type ? `- Soil Type: ${soil_type}` : ''}
${irrigationDaysAgo ? `- Last Irrigation: ${irrigationDaysAgo} days ago (CRITICAL: Use this information to calculate optimal next irrigation timing, frequency, and amount. Consider crop water requirements, soil moisture retention, and weather forecast when recommending next irrigation.)` : ''}

MODE RULES:
- If mode is "no_crop": NDVI < 0.5 indicates field is likely fallow, not currently cropped, or crop is in very early stage. CRITICAL: Focus EXCLUSIVELY on recommended_crops array with best crops to sow NOW given current season, region (lat/lon), weather forecast, and soil health. Provide 3-5 crop recommendations with:
  - Detailed sowing windows (start date, end date, optimal date)
  - Yield predictions based on current conditions
  - Suitability scores and reasons
  - Growth duration and requirements
  - Market insights for each crop
  Set current_crop_advisory.enabled = false. Do NOT provide current_crop_advisory details. Return recommended_crops array with comprehensive crop suggestions.
- If mode is "ask_current_crop": NDVI >= 0.5 indicates active vegetation but current crop is unknown. Provide recommended_crops array with general crop recommendations that match the NDVI level, but emphasize asking the farmer to select their current crop to get stage-wise guidance. Set current_crop_advisory.enabled = false.
- If mode is "current_crop": The farmer provided current crop${cropSowingDate ? ` and sowing date (${new Date(cropSowingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })})` : ''}. CRITICAL: Focus EXCLUSIVELY on current_crop_advisory. Set current_crop_advisory.enabled = true. Provide detailed stage-wise guidance (next 2–4 weeks) based on${cropSowingDate ? ` the crop's current growth stage (calculate days since sowing and growth phase)` : ''} current conditions. For recommended_crops array, return an EMPTY array [] since the farmer already has a crop. The primary focus must be on current_crop_advisory with:
  ${cropSowingDate ? `- Current growth stage and days since sowing (calculate exact days from sowing date to today)\n  - Stage-specific recommendations (sowing, vegetative, flowering, grain filling, maturity) based on current growth phase\n  - Growth milestones and expected timeline for next stages\n  - Days until next critical growth stage\n` : ''}  - Detailed irrigation schedule${irrigationDaysAgo ? ` (especially important: last irrigation was ${irrigationDaysAgo} days ago, calculate optimal next irrigation based on this)` : ''} with specific dates and amounts
  - Fertilizer and biofertilizer plans (organic farming techniques preferred) tailored to current growth stage
  - Ways to increase yield (specific to current growth stage and crop condition)
  - Pest/disease watchlist for current growth stage
  - Yield prediction and outlook updates based on current crop progress
  - Organic farming techniques and biofertilizer guidance for current stage

Provide a comprehensive JSON response with the following structure (respond ONLY with valid JSON, no additional text):

CRITICAL JSON STRUCTURE RULES:
${isCurrentCropMode ? `- MODE: "current_crop" - Farmer has provided current crop (${currentCrop})${cropSowingDate ? ` and sowing date (${daysSinceSowing} days ago)` : ''}
- Set "recommended_crops" to EMPTY array: []
- Set "best_crop" to null
- Set "current_crop_advisory.enabled" to true
- Focus ALL content on "current_crop_advisory" with detailed stage-wise guidance
- Provide comprehensive "next_weeks_plan" with 4 weeks of detailed plans
${cropSowingDate ? `- Calculate exact days since sowing: ${daysSinceSowing} days
- Determine current growth stage based on days since sowing
- Provide stage-specific recommendations for each week` : ''}
- Do NOT provide crop recommendations since farmer already has a crop` : advisoryMode === 'no_crop' ? `- MODE: "no_crop" - NDVI < 0.5 (Field appears fallow or not currently cropped)
- Set "recommended_crops" to array with 3-5 BEST crops to sow NOW
- Set "best_crop" with the most suitable crop recommendation
- Set "current_crop_advisory.enabled" to false
- Focus ALL content on crop recommendations with detailed sowing windows, yield predictions, and suitability analysis
- Do NOT provide current_crop_advisory details
- Consider current season, weather forecast, soil health, and regional suitability` : `- MODE: "${advisoryMode}" - NDVI >= 0.5 (Active vegetation detected)
- Provide "recommended_crops" array with crop suggestions that match the vegetation level
- Set "current_crop_advisory.enabled" to false
- Emphasize that farmer should select their current crop for stage-wise guidance`}

{
  "recommended_crops": ${isCurrentCropMode ? '[]' : `[
    {
      "crop_name": "crop name in user's language",
      "scientific_name": "scientific name",
      "suitability_score": 0-100,
      "reason": "why this crop is suitable",
      "season": "season name",
      "image_url": "/assets/bg_farm_field.png",
      "sowing_window": {
        "start": "start date",
        "end": "end date",
        "optimal_date": "optimal date"
      },
      "yield_prediction": {
        "estimated_yield": "X tons/hectare",
        "confidence": "high/medium/low",
        "factors": ["factor1", "factor2"]
      },
      "growth_duration": "X days"
    }
  ]`},
  "best_crop": ${isCurrentCropMode ? 'null' : `{
    "crop_name": "best crop name",
    "reasons": ["reason1", "reason2"],
    "expected_yield": "X tons/hectare",
    "image_url": "https://example.com/representative-crop-image.jpg"
  }`},
  "soil_health": {
    "ph": "number or N/A",
    "clay_percent": "number or N/A",
    "sand_percent": "number or N/A",
    "silt_percent": "number or N/A",
    "soil_organic_carbons": "number or N/A",
    "interpretation": "what this means for crop selection and management"
  },
  "indices_analysis": {
    "ndvi_interpretation": "explanation of NDVI value",
    "health_status": "detailed health analysis",
    "stress_indicators": ["indicator1", "indicator2"],
    "improvement_recommendations": ["recommendation1", "recommendation2"]
  },
  "fertilizer_guidance": {
    "organic_methods": [
      {
        "type": "compost/vermicompost/biofertilizer etc",
        "application_rate": "X kg/hectare",
        "timing": "when to apply",
        "method": "application method",
        "benefits": "benefits description"
      }
    ],
    "biofertilizers": [
      {
        "type": "Azotobacter/Rhizobium etc",
        "application": "how to apply",
        "dosage": "dosage information"
      }
    ],
    "schedule": {
      "pre_sowing": "recommendations",
      "during_growth": "recommendations",
      "harvest_preparation": "recommendations"
    }
  },
  "irrigation_plan": {
    "frequency": "how often",
    "amount": "X mm per session",
    "method": "drip/flood/sprinkler",
    "next_irrigation": "date and time${irrigationDaysAgo ? ` (considering last irrigation was ${irrigationDaysAgo} days ago)` : ''}",
    "last_irrigation_days_ago": ${irrigationDaysAgo || 'null'},
    "irrigation_status": "${irrigationDaysAgo ? `Irrigated ${irrigationDaysAgo} days ago. ` : ''}Based on this, provide optimal next irrigation timing and amount considering crop stage, weather forecast, and soil moisture.",
    "water_conservation_tips": ["tip1", "tip2"]
  },
  "pest_disease_management": {
    "potential_risks": ["risk1", "risk2"],
    "preventive_measures": ["measure1", "measure2"],
    "organic_solutions": ["solution1", "solution2"]
  },
  "market_insights": {
    "best_selling_period": "time period",
    "expected_price_range": "price range",
    "market_demand": "high/medium/low"
  },
  "seasonal_calendar": {
    "current_season": "season name",
    "next_season_preparation": "what to prepare",
    "year_round_activities": ["activity1", "activity2"]
  },
  "current_crop_advisory": {
    "enabled": ${isCurrentCropMode ? 'true' : 'false'},
    "crop_name": "${currentCrop || 'N/A'}",${cropSowingDate ? `
    "sowing_date": "${new Date(cropSowingDate).toISOString().split('T')[0]}",
    "days_since_sowing": ${daysSinceSowing},
    "current_growth_stage": "Calculate based on days since sowing (e.g., 'Vegetative', 'Flowering', 'Grain Filling', 'Maturity')",
    "growth_stage_details": {
      "stage_name": "current stage name",
      "stage_description": "description of current growth phase",
      "days_in_stage": "days spent in current stage",
      "expected_duration": "total expected days for this stage",
      "next_stage": "name of next expected stage",
      "days_until_next_stage": "estimated days until next stage"
    },` : ''}
    "next_weeks_plan": [
      ${cropSowingDate ? `{
        "week": 1,
        "week_start_date": "calculate from today",
        "days_since_sowing_at_week_start": ${daysSinceSowing !== null ? daysSinceSowing : 'N/A'},
        "expected_growth_stage": "expected stage for this week based on days since sowing",
        "tasks": ["stage-specific task1", "stage-specific task2"],
        "fertilizer": { 
          "type": "fertilizer type for current growth stage", 
          "rate": "application rate for current stage", 
          "timing": "when to apply this week",
          "method": "application method",
          "notes": "stage-specific fertilizer notes" 
        },
        "irrigation": { 
          "frequency": "irrigation frequency for current stage", 
          "amount": "water amount per session", 
          "timing": "${irrigationDaysAgo ? `Based on last irrigation ${irrigationDaysAgo} days ago, calculate optimal next irrigation timing for current growth stage` : 'General irrigation timing for current stage'}", 
          "next_irrigation_date": "specific date for next irrigation",
          "notes": "${irrigationDaysAgo ? `Last irrigation was ${irrigationDaysAgo} days ago. Consider current crop stage (${cropSowingDate ? 'calculate stage from days since sowing' : 'N/A'}), soil moisture, and weather when recommending next irrigation.` : 'Consider crop stage, soil moisture, and weather.'}" 
        },
        "pest_watch": ["pest1 relevant to current stage", "pest2 relevant to current stage"],
        "disease_watch": ["disease1 relevant to current stage", "disease2 relevant to current stage"],
        "growth_milestones": ["milestone1 expected this week", "milestone2 expected this week"]
      },
      {
        "week": 2,
        "week_start_date": "calculate from today + 7 days",
        "days_since_sowing_at_week_start": ${daysSinceSowing !== null ? daysSinceSowing + 7 : 'N/A'},
        "expected_growth_stage": "expected stage for week 2",
        "tasks": ["stage-specific tasks for week 2"],
        "fertilizer": { "type": "", "rate": "", "timing": "", "method": "", "notes": "" },
        "irrigation": { "frequency": "", "amount": "", "timing": "", "next_irrigation_date": "", "notes": "" },
        "pest_watch": [],
        "disease_watch": [],
        "growth_milestones": []
      },
      {
        "week": 3,
        "week_start_date": "calculate from today + 14 days",
        "days_since_sowing_at_week_start": ${daysSinceSowing !== null ? daysSinceSowing + 14 : 'N/A'},
        "expected_growth_stage": "expected stage for week 3",
        "tasks": ["stage-specific tasks for week 3"],
        "fertilizer": { "type": "", "rate": "", "timing": "", "method": "", "notes": "" },
        "irrigation": { "frequency": "", "amount": "", "timing": "", "next_irrigation_date": "", "notes": "" },
        "pest_watch": [],
        "disease_watch": [],
        "growth_milestones": []
      },
      {
        "week": 4,
        "week_start_date": "calculate from today + 21 days",
        "days_since_sowing_at_week_start": ${daysSinceSowing !== null ? daysSinceSowing + 21 : 'N/A'},
        "expected_growth_stage": "expected stage for week 4",
        "tasks": ["stage-specific tasks for week 4"],
        "fertilizer": { "type": "", "rate": "", "timing": "", "method": "", "notes": "" },
        "irrigation": { "frequency": "", "amount": "", "timing": "", "next_irrigation_date": "", "notes": "" },
        "pest_watch": [],
        "disease_watch": [],
        "growth_milestones": []
      }` : `{
        "week": 1,
        "tasks": ["task1", "task2"],
        "fertilizer": { "type": "", "rate": "", "notes": "" },
        "irrigation": { "frequency": "", "amount": "", "timing": "${irrigationDaysAgo ? `Based on last irrigation ${irrigationDaysAgo} days ago, calculate optimal next irrigation timing` : 'General irrigation timing'}", "notes": "${irrigationDaysAgo ? `Last irrigation was ${irrigationDaysAgo} days ago. Consider crop stage, soil moisture, and weather when recommending next irrigation.` : ''}" },
        "pest_watch": ["pest1", "pest2"]
      }`}
    ],
    ${cropSowingDate ? `"yield_forecast": {
      "current_stage_yield_potential": "yield potential based on current growth stage",
      "expected_total_yield": "estimated total yield based on current progress",
      "yield_confidence": "high/medium/low",
      "factors_affecting_yield": ["factor1", "factor2"],
      "yield_improvement_opportunities": ["opportunity1", "opportunity2"]
    },
    "harvest_timeline": {
      "expected_harvest_date": "calculate expected harvest date based on sowing date and crop duration",
      "days_until_harvest": "days remaining until harvest",
      "pre_harvest_preparations": ["preparation1", "preparation2"]
    },` : ''}
    "summary": {
      "current_status": "overall status of the current crop",
      "key_priorities": ["priority1", "priority2", "priority3"],
      "immediate_actions": ["action1", "action2"],
      "warnings": ["warning1 if any", "warning2 if any"]
    }
  },
  "action_items": [
    {
      "priority": "high/medium/low",
      "action": "action description",
      "deadline": "deadline date",
      "estimated_cost": "cost if applicable"
    }
  ],
  "youtube_queries": [
    "Search query 1 for YouTube videos related to this crop and recommendations",
    "Search query 2 for organic farming techniques for this crop",
    "Search query 3 for biofertilizer application for this crop",
    "Search query 4 for yield improvement techniques for this crop",
    "Search query 5 for pest/disease management for this crop"
  ]
}

IMPORTANT: Include 5 YouTube search queries in the "youtube_queries" array. These should be relevant to:
- The current crop (if provided)
- Organic farming techniques
- Biofertilizer application
- Yield improvement methods
- Pest/disease management
- Growth stage-specific guidance (if sowing date provided)
Make queries in ${languageName} language for better search results.

Respond with ONLY valid JSON, no markdown formatting or code blocks.`;

    // DEBUG: Log the full prompt being sent
    console.log('📝 PROMPT SENT TO GEMINI:');
    console.log('═'.repeat(80));
    console.log(prompt);
    console.log('═'.repeat(80));
    console.log(`📏 Prompt length: ${prompt.length} characters`);
    console.log(`🌐 Language: ${languageName} (${userLanguage})`);
    console.log(`📍 Field: ${field_ID}`);
    console.log(`👤 Farmer: ${farmer_ID}`);
    
    // Utility sleep for backoff
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Call Gemini API - try different API versions and models if one fails
    let geminiResponse = null;
    let lastError = null;
    let usedModel = null;
    let usedVersion = null;
    const startTime = Date.now();
    
    // First, try to list available models to see what's actually available
    let availableModels = null;
    let modelsToTry = DEFAULT_GEMINI_MODELS;
    
    try {
      const listModelsUrl = `https://generativelanguage.googleapis.com/v1/models?key=${GEMINI_API_KEY}`;
      console.log('🔍 Checking available Gemini models...');
      const modelsResponse = await axios.get(listModelsUrl, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      if (modelsResponse.data?.models) {
        availableModels = modelsResponse.data.models.map(m => {
          // Extract model name - might be "models/gemini-2.5-flash" or just "gemini-2.5-flash"
          let modelName = m.name || '';
          if (modelName.startsWith('models/')) {
            modelName = modelName.replace('models/', '');
          }
          return modelName;
        });
        console.log(`✅ Found ${availableModels.length} available models:`, availableModels.slice(0, 5).join(', '));
        
        // Try to find matching default models first
        const matchedModels = DEFAULT_GEMINI_MODELS.filter(defaultModel => {
          return availableModels.some(available => {
            // Check exact match or if available model name contains default model identifier
            return available === defaultModel || 
                   available.includes(defaultModel.replace('gemini-', ''));
          });
        });
        
        if (matchedModels.length > 0) {
          modelsToTry = matchedModels;
          console.log(`📋 Using ${modelsToTry.length} matching default models:`, modelsToTry.join(', '));
        } else {
          // No default models match, use available models directly (prefer flash models)
          console.log('⚠️  No default models match, using available models directly');
          // Prefer flash models (faster), then pro models
          const flashModels = availableModels.filter(m => m.includes('flash') && !m.includes('lite'));
          const liteModels = availableModels.filter(m => m.includes('flash-lite'));
          const proModels = availableModels.filter(m => m.includes('pro') && !m.includes('flash'));
          const otherModels = availableModels.filter(m => !m.includes('flash') && !m.includes('pro'));
          modelsToTry = [
            ...flashModels.slice(0, 3),  // Prefer flash models first
            ...proModels.slice(0, 2),     // Then pro models
            ...liteModels.slice(0, 1),    // Then lite models
            ...otherModels.slice(0, 1)    // Then others
          ].filter(Boolean); // Remove undefined/null
        
          if (modelsToTry.length === 0) {
            modelsToTry = availableModels.slice(0, 6); // Fallback to first 6 available
          }
          console.log(`📋 Will try ${modelsToTry.length} available models:`, modelsToTry.join(', '));
        }
      }
    } catch (listError) {
      console.log('⚠️  Could not list models, will try default models');
    }
    
    // Try each API version and model combination
    for (const apiVersion of API_VERSIONS) {
      for (const model of modelsToTry) {
        
        try {
          const GEMINI_API_URL = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
          console.log(`🔗 Trying Gemini ${apiVersion}/${model}`);
          console.log(`   URL: ${GEMINI_API_URL.replace(GEMINI_API_KEY, '***')}`);
          
          const doCall = async () => axios.post(
            GEMINI_API_URL,
            { contents: [{ parts: [{ text: prompt }] }] },
            { headers: { 'Content-Type': 'application/json' }, timeout: 45000 }
          );

          // Simple retry for timeout/429
          let attempt = 0;
          const maxAttempts = 2; // one retry
          while (attempt < maxAttempts) {
            try {
              geminiResponse = await doCall();
              break;
            } catch (e) {
              const status = e?.response?.status;
              const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.includes('timeout');
              if (status === 429) {
                const retryAfter = Number(e?.response?.headers?.['retry-after']) || 25000;
                console.log(`⏳ 429 rate limit. Waiting ${retryAfter}ms then retrying...`);
                await sleep(retryAfter);
              } else if (isTimeout) {
                const backoff = 5000 * (attempt + 1);
                console.log(`⏳ Timeout. Backing off ${backoff}ms then retrying...`);
                await sleep(backoff);
              } else {
                throw e;
              }
            }
            attempt += 1;
          }

          if (!geminiResponse) {
            // All attempts failed for this model/version
            throw lastError || new Error('No response from Gemini after retries');
          }
          
          usedModel = model;
          usedVersion = apiVersion;
          console.log(`✅ Success with ${apiVersion}/${model}`);
          break; // Success, exit loops
        } catch (error) {
          lastError = error;
          if (error.response) {
            const status = error.response.status;
            const statusText = error.response.statusText;
            console.log(`❌ ${apiVersion}/${model} failed: ${status} - ${statusText}`);
            if (error.response.data) {
              const errorData = error.response.data;
              const errorMsg = errorData.error?.message || JSON.stringify(errorData).substring(0, 200);
              console.log(`   Error: ${errorMsg}`);
            }
          } else {
            console.log(`❌ ${apiVersion}/${model} failed: ${error.message}`);
          }
          // Continue to next model/version
          continue;
        }
      }
      if (geminiResponse) break; // Exit outer loop if successful
    }
    
    if (!geminiResponse) {
      // All models failed
      console.error('❌ All Gemini models failed');
      if (lastError?.response) {
        const errorData = lastError.response.data || {};
        const errorMessage = errorData.error?.message || errorData.message || lastError.message;
        console.error('   Last error details:', JSON.stringify(errorData, null, 2));
        throw new Error(
          `Gemini API error (${lastError.response.status}): ${errorMessage}`
        );
      }
      throw new Error(`Gemini API failed: ${lastError?.message || 'Unknown error'}`);
    }
    
    const responseTime = Date.now() - startTime;
    console.log(`⏱️  Gemini API response time: ${responseTime}ms (${usedVersion}/${usedModel})`);
    
    // Extract response text
    const responseText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('📥 RAW GEMINI RESPONSE:');
    console.log('═'.repeat(80));
    console.log(responseText.substring(0, 1000) + (responseText.length > 1000 ? '...' : ''));
    console.log(`📏 Response length: ${responseText.length} characters`);
    console.log(`🤖 API version: ${usedVersion}, Model: ${usedModel}`);
    console.log('═'.repeat(80));
    
    // Parse JSON from response (handle markdown code blocks if present)
    let aiRecommendations;
    try {
      // Try to extract JSON from response (might be wrapped in markdown)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiRecommendations = JSON.parse(jsonMatch[0]);
        console.log('✅ Successfully extracted JSON from response');
      } else {
        aiRecommendations = JSON.parse(responseText);
        console.log('✅ Successfully parsed JSON directly');
      }
      
      // DEBUG: Log parsed structure
      console.log('📋 PARSED AI RECOMMENDATIONS STRUCTURE:');
      console.log('  - API version:', usedVersion, 'Model:', usedModel);
      console.log('  - recommended_crops:', aiRecommendations.recommended_crops?.length || 0);
      if (aiRecommendations.recommended_crops?.length > 0) {
        console.log('    First crop:', aiRecommendations.recommended_crops[0].crop_name);
      }
      console.log('  - best_crop:', aiRecommendations.best_crop?.crop_name || 'N/A');
      console.log('  - fertilizer_guidance:', !!aiRecommendations.fertilizer_guidance);
      console.log('  - irrigation_plan:', !!aiRecommendations.irrigation_plan);
      console.log('  - yield_prediction:', !!aiRecommendations.recommended_crops?.[0]?.yield_prediction);
      console.log('  - action_items:', aiRecommendations.action_items?.length || 0);
      
    } catch (parseError) {
      console.error('❌ FAILED TO PARSE GEMINI RESPONSE:');
      console.error('   Error:', parseError.message);
      console.error('   Response preview:', responseText.substring(0, 500));
      // Return structured fallback
      aiRecommendations = {
        error: 'Failed to parse AI response',
        parse_error: parseError.message,
        raw_response: responseText.substring(0, 1000),
      };
    }
    
    console.log('✅ AI recommendations generated successfully');
    console.log(`📊 Summary: ${aiRecommendations.recommended_crops?.length || 0} crops recommended, best crop: ${aiRecommendations.best_crop?.crop_name || 'N/A'}`);
    
    // Fetch YouTube videos based on queries from AI response
    let videos = [];
    const youtubeQueries = aiRecommendations.youtube_queries || [];
    if (youtubeQueries.length > 0) {
      try {
        const YT_API_KEY = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY;
        if (YT_API_KEY) {
          console.log('📺 Fetching YouTube videos for', youtubeQueries.length, 'queries...');
          const videoPromises = youtubeQueries.slice(0, 5).map(async (query) => {
            try {
              const ytUrl = `https://www.googleapis.com/youtube/v3/search?key=${YT_API_KEY}&part=snippet&type=video&maxResults=3&q=${encodeURIComponent(query)}`;
              const ytResp = await axios.get(ytUrl, { timeout: 10000 });
              if (ytResp.data?.items && ytResp.data.items.length > 0) {
                return ytResp.data.items.map(item => ({
                  videoId: item.id?.videoId || null,
                  title: item.snippet?.title || 'Untitled',
                  description: item.snippet?.description || '',
                  thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || null,
                  channelTitle: item.snippet?.channelTitle || 'Unknown Channel',
                  publishedAt: item.snippet?.publishedAt || null,
                  url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : null,
                }));
              }
              return [];
            } catch (queryError) {
              console.warn(`⚠️ Error fetching YouTube videos for query "${query}":`, queryError.message);
              return [];
            }
          });
          
          const videoResults = await Promise.all(videoPromises);
          videos = videoResults.flat().slice(0, 15); // Limit to 15 videos total
          console.log(`✅ Fetched ${videos.length} YouTube videos`);
        } else {
          console.warn('⚠️ YouTube API key not configured, skipping video fetch');
        }
      } catch (videoError) {
        console.warn('⚠️ Error fetching YouTube videos:', videoError.message);
      }
    }
    
    res.json({ 
      recommendations: aiRecommendations, 
      videos: videos,
      language: userLanguage,
      api_version: usedVersion,
      model_used: usedModel,
      ok: true 
    });
    
  } catch (error) {
    console.error('Error generating AI recommendations:', error);
    res.status(500).json({ 
      error: 'Failed to generate AI recommendations', 
      message: error.message 
    });
  }
});

// Configure Cloudinary for image uploads
let cloudinaryConfigured = false;
try {
  const CLOUDINARY_URL = process.env.CLOUDINARY_URL;
  const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
  const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
  const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
  
  let cloudName, apiKey, apiSecret;
  
  if (CLOUDINARY_URL) {
    try {
      const url = new URL(CLOUDINARY_URL);
      apiKey = url.username;
      apiSecret = url.password;
      cloudName = url.hostname;
    } catch (parseError) {
      cloudName = CLOUDINARY_CLOUD_NAME;
      apiKey = CLOUDINARY_API_KEY;
      apiSecret = CLOUDINARY_API_SECRET;
    }
  } else {
    cloudName = CLOUDINARY_CLOUD_NAME;
    apiKey = CLOUDINARY_API_KEY;
    apiSecret = CLOUDINARY_API_SECRET;
  }
  
  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    cloudinaryConfigured = true;
    console.log('✅ Cloudinary configured in server.js');
  }
} catch (cloudinaryError) {
  console.warn('⚠️ Cloudinary configuration error:', cloudinaryError.message);
}

// POST /api/v1/soil-health-card/upload - Upload soil health card to Cloudinary
app.post('/api/v1/soil-health-card/upload', upload.single('file'), async (req, res) => {
  try {
    const { farmer_ID, field_ID } = req.body || {};
    
    if (!req.file && !req.body?.file_base64) {
      return res.status(400).json({ error: 'No file provided. Send multipart/form-data with "file" field or JSON with "file_base64"' });
    }

    let fileBuffer = null;
    let filename = 'soil_health_card.jpg';
    let resourceType = 'image';

    if (req.file && req.file.buffer) {
      fileBuffer = req.file.buffer;
      filename = req.file.originalname || filename;
      // Determine resource type from filename
      if (filename.toLowerCase().endsWith('.pdf')) {
        resourceType = 'raw';
      }
    } else if (req.body?.file_base64) {
      const base64 = String(req.body.file_base64).replace(/^data:[^;]+;base64,/, '');
      fileBuffer = Buffer.from(base64, 'base64');
      filename = req.body.filename || filename;
      if (filename.toLowerCase().endsWith('.pdf')) {
        resourceType = 'raw';
      }
    }

    if (!cloudinaryConfigured) {
      return res.status(500).json({ error: 'Cloudinary is not configured' });
    }

    console.log('📤 Uploading soil health card to Cloudinary...', { filename, resourceType, size: fileBuffer.length });

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: resourceType,
          folder: 'soil_health_cards',
          public_id: `${farmer_ID || 'anonymous'}_${field_ID || 'field'}_${Date.now()}`,
          overwrite: false,
        },
        (error, result) => {
          if (error) {
            console.error('❌ Cloudinary upload error:', error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
      uploadStream.end(fileBuffer);
    });

    const fileUrl = uploadResult.secure_url || uploadResult.url;
    console.log('✅ Soil health card uploaded:', fileUrl);

    // Store in Firestore
    try {
      if (farmer_ID) {
        await db.collection('soil_health_cards').add({
          farmer_ID,
          field_ID: field_ID || null,
          fileUrl,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
          fieldName: field_ID || null,
          resourceType,
        });
        console.log('✅ Card metadata saved to Firestore');
      }
    } catch (dbError) {
      console.warn('⚠️ Failed to save to Firestore:', dbError.message);
      // Continue anyway - upload succeeded
    }

    res.json({
      success: true,
      url: fileUrl,
      fileUrl: fileUrl,
      message: 'File uploaded successfully',
      publicId: uploadResult.public_id,
    });
  } catch (error) {
    console.error('❌ Error uploading soil health card:', error);
    res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
});

// POST /api/v1/soil-health-card/extract - Extract text from soil health card using OCR
app.post('/api/v1/soil-health-card/extract', async (req, res) => {
  try {
    const { fileUrl, farmer_ID, field_ID } = req.body || {};
    
    if (!fileUrl) {
      return res.status(400).json({ error: 'fileUrl is required' });
    }

    console.log('🔍 Extracting text from soil health card...', { fileUrl: fileUrl.substring(0, 50) + '...' });

    // Use Google Cloud Vision API for OCR (if available)
    // Fallback: Use a simple OCR service or return placeholder
    const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
    let extractedText = '';

    if (GOOGLE_VISION_API_KEY) {
      try {
        // Use Google Cloud Vision API for OCR
        // First, download the image if it's a URL
        let imageBuffer = null;
        if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
          const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 15000 });
          imageBuffer = Buffer.from(imageResponse.data);
        } else {
          // Assume it's already a base64 string or buffer
          imageBuffer = Buffer.from(fileUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }
        
        const base64Image = imageBuffer.toString('base64');
        
        const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;
        const visionResponse = await axios.post(visionUrl, {
          requests: [{
            image: { content: base64Image },
            features: [{ type: 'TEXT_DETECTION', maxResults: 10 }],
          }],
        }, { 
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        });

        if (visionResponse.data?.responses?.[0]?.textAnnotations?.[0]?.description) {
          extractedText = visionResponse.data.responses[0].textAnnotations[0].description;
          console.log('✅ Text extracted using Google Vision API');
        }
      } catch (visionError) {
        console.warn('⚠️ Google Vision API failed, using fallback:', visionError.message);
      }
    }

    // Fallback: Use Hugging Face OCR model or simple extraction
    if (!extractedText) {
      try {
        // Try Hugging Face OCR model as fallback
        const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;
        if (HF_TOKEN) {
          const hfClient = new InferenceClient(HF_TOKEN);
          const response = await hfClient.documentQuestionAnswering({
            model: 'naver-clova-ix/donut-base-finetuned-cord-v2',
            inputs: fileUrl,
          });
          if (response?.answer) {
            extractedText = response.answer;
            console.log('✅ Text extracted using Hugging Face OCR');
          }
        }
      } catch (hfError) {
        console.warn('⚠️ Hugging Face OCR failed:', hfError.message);
      }
    }

    // If still no text, return a placeholder message
    if (!extractedText) {
      extractedText = 'Text extraction not available. Please ensure GOOGLE_VISION_API_KEY or HUGGINGFACE_API_KEY is configured.';
      console.warn('⚠️ No OCR service available, returning placeholder');
    }

    // Update Firestore with extracted text
    try {
      if (farmer_ID && fileUrl) {
        // Find the document by fileUrl and update it
        const cardsRef = db.collection('soil_health_cards');
        const snapshot = await cardsRef.where('fileUrl', '==', fileUrl).limit(1).get();
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          await doc.ref.update({
            extractedText,
            extractedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log('✅ Extracted text saved to Firestore');
        }
      }
    } catch (dbError) {
      console.warn('⚠️ Failed to update Firestore:', dbError.message);
    }

    res.json({
      success: true,
      extractedText,
      text: extractedText, // Alias for compatibility
      confidence: extractedText ? 0.9 : 0,
      message: 'Text extraction completed',
    });
  } catch (error) {
    console.error('❌ Error extracting text:', error);
    res.status(500).json({ error: error.message || 'Failed to extract text' });
  }
});

// GET /api/v1/soil-health-card/history - Get upload history
app.get('/api/v1/soil-health-card/history', async (req, res) => {
  try {
    const { farmer_ID, field_ID, limit = 20 } = req.query || {};
    
    if (!farmer_ID) {
      return res.status(400).json({ error: 'farmer_ID is required' });
    }

    console.log('📋 Fetching soil health card history...', { farmer_ID, field_ID, limit });

    let query = db.collection('soil_health_cards').where('farmer_ID', '==', farmer_ID);
    
    if (field_ID) {
      query = query.where('field_ID', '==', field_ID);
    }
    
    query = query.orderBy('uploadedAt', 'desc').limit(parseInt(limit, 10));

    const snapshot = await query.get();
    const items = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        fileUrl: data.fileUrl,
        extractedText: data.extractedText || '',
        uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || data.uploadedAt || new Date().toISOString(),
        field_ID: data.field_ID,
        farmer_ID: data.farmer_ID,
        fieldName: data.fieldName,
      };
    });

    console.log(`✅ Found ${items.length} cards in history`);

    res.json({
      success: true,
      items,
      count: items.length,
    });
  } catch (error) {
    console.error('❌ Error getting soil health card history:', error);
    res.status(500).json({ error: error.message || 'Failed to get history' });
  }
});

// GET /api/v1/kisan-seva-kendra/nearest - Get nearest Kisan Seva Kendra centers using Google Places API
app.get('/api/v1/kisan-seva-kendra/nearest', async (req, res) => {
  try {
    const { lat, lon, limit = 3 } = req.query || {};
    
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }

    console.log('📍 Finding nearest Kisan Seva Kendra centers using Google Places API...', { lat, lon, limit });

    const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyCUfuyYZd9WaIjfBSLnBZEt_etDUjxlYbE';
    const radius = 50000; // 50km radius
    const searchQueries = [
      'Kisan Seva Kendra',
      'Krishi Vigyan Kendra',
      'Soil Testing Lab',
      'Agriculture Office',
      'Fertilizer Shop',
      'Mandi Office',
    ];

    let allResults = [];

    // Search for each query type
    for (const query of searchQueries) {
      try {
        const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=${radius}&keyword=${encodeURIComponent(query)}&key=${GOOGLE_PLACES_API_KEY}`;
        
        console.log(`🔍 Searching for: ${query}`);
        const placesResp = await axios.get(placesUrl, { timeout: 10000 });
        
        if (placesResp.data?.results && placesResp.data.results.length > 0) {
          const places = placesResp.data.results.map(place => ({
            name: place.name || 'Unnamed Place',
            address: place.vicinity || place.formatted_address || 'Address not available',
            lat: place.geometry?.location?.lat,
            lon: place.geometry?.location?.lng,
            place_id: place.place_id,
            rating: place.rating || null,
            types: place.types || [],
            type: query, // Store the search query that found this place
          }));
          
          allResults = allResults.concat(places);
          console.log(`✅ Found ${places.length} results for "${query}"`);
        }
      } catch (queryError) {
        console.warn(`⚠️ Error searching for "${query}":`, queryError.message);
        // Continue with other queries
      }
    }

    // Remove duplicates based on place_id
    const uniqueResults = [];
    const seenPlaceIds = new Set();
    for (const result of allResults) {
      if (result.place_id && !seenPlaceIds.has(result.place_id)) {
        seenPlaceIds.add(result.place_id);
        uniqueResults.push(result);
      }
    }

    // Calculate distances and sort
    const R = 6371; // Earth radius in km
    const centersWithDistance = uniqueResults.map(center => {
      if (!center.lat || !center.lon) return null;
      
      const dLat = (center.lat - parseFloat(lat)) * Math.PI / 180;
      const dLon = (center.lon - parseFloat(lon)) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(parseFloat(lat) * Math.PI / 180) * Math.cos(center.lat * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      
      return {
        ...center,
        distance: `${distance.toFixed(1)} km`,
        distanceKm: distance,
      };
    })
    .filter(center => center !== null) // Remove invalid centers
    .sort((a, b) => a.distanceKm - b.distanceKm) // Sort by distance
    .slice(0, parseInt(limit, 10)); // Limit results

    console.log(`✅ Found ${centersWithDistance.length} unique nearest centers`);

    // Try to get phone numbers for top results using Place Details API
    const enrichedCenters = await Promise.all(
      centersWithDistance.map(async (center) => {
        if (!center.place_id) return center;
        
        try {
          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${center.place_id}&fields=formatted_phone_number,international_phone_number&key=${GOOGLE_PLACES_API_KEY}`;
          const detailsResp = await axios.get(detailsUrl, { timeout: 5000 });
          
          if (detailsResp.data?.result) {
            return {
              ...center,
              phone: detailsResp.data.result.formatted_phone_number || 
                     detailsResp.data.result.international_phone_number || 
                     null,
            };
          }
        } catch (detailsError) {
          console.warn(`⚠️ Could not fetch details for ${center.place_id}:`, detailsError.message);
        }
        
        return center;
      })
    );

    res.json({
      success: true,
      centers: enrichedCenters.map(({ distanceKm, ...center }) => center),
      count: enrichedCenters.length,
    });
  } catch (error) {
    console.error('❌ Error finding nearest Kisan centers:', error);
    res.status(500).json({ error: error.message || 'Failed to find centers' });
  }
});

// POST /api/v1/soil-advisory - Soil health advisory with Gemini + YouTube
app.post('/api/v1/soil-advisory', async (req, res) => {
  try {
    const { field_ID, farmer_ID, language = 'en', field_location, extractedText, hasSoilHealthCard } = req.body || {};
    console.log('🧪 SOIL API request:', { field_ID, farmer_ID, language, field_location });
    if (!farmer_ID || !field_ID) {
      return res.status(400).json({ error: 'field_ID and farmer_ID are required' });
    }
    let userLanguage = language;
    try {
      if (!userLanguage || userLanguage === 'en') {
        const uDoc = await db.collection('users').doc(farmer_ID).get();
        if (uDoc.exists) userLanguage = uDoc.data().language || 'en';
      }
    } catch {}
    console.log('🧪 SOIL API user language:', userLanguage);

    const lat = field_location?.lat;
    const lon = field_location?.lon;
    let soil = null;
    const debug = { soilgrids: {}, gemini: {}, youtube: {} };
    // SoilGrids v2: properties.layers[] with depth ranges and values
    const pickLayerValue = (layers, name, preferredLabel = '0-5cm') => {
      if (!Array.isArray(layers)) return { value: null, meta: {} };
      const layer = layers.find(l => l?.name === name);
      if (!layer) return { value: null, meta: {} };
      const unit = layer.unit_measure || {};
      let depthEntry = null;
      if (Array.isArray(layer.depths)) {
        depthEntry = layer.depths.find(d => d?.label === preferredLabel)
          || layer.depths.find(d => d?.label === '0-30cm')
          || layer.depths.find(d => d?.label === '5-15cm')
          || layer.depths[0];
      }
      const vals = depthEntry?.values || {};
      // priority: mean, Q0.5, then any numeric
      let raw = (typeof vals.mean === 'number') ? vals.mean : (typeof vals['Q0.5'] === 'number' ? vals['Q0.5'] : null);
      if (raw === null) {
        for (const k of Object.keys(vals)) {
          if (typeof vals[k] === 'number') { raw = vals[k]; break; }
        }
      }
      // convert units using d_factor to target_units as per SoilGrids
      let converted = raw;
      const d = unit.d_factor || 1;
      // Most layers require division by d_factor to reach target units
      if (typeof raw === 'number' && d && d !== 1) {
        converted = raw / d;
      }
      // Special case: phh2o: pH*10 -> divide by 10 already handled via d_factor=10
      // Clip precision
      if (typeof converted === 'number') converted = Number(converted.toFixed(3));
      return { value: converted, raw, meta: { unit, label: depthEntry?.label, valuesKeys: Object.keys(vals) } };
    };

    if (typeof lat === 'number' && typeof lon === 'number') {
      try {
        const params = new URLSearchParams();
        params.append('lon', String(lon));
        params.append('lat', String(lat));
        const props = ['bdod','cec','cfvo','clay','nitrogen','ocd','ocs','phh2o','sand','silt','soc','wv0010','wv0033','wv1500'];
        props.forEach(p => params.append('property', p));
        const depths = ['0-5cm','0-30cm','5-15cm','15-30cm','30-60cm','60-100cm','100-200cm'];
        depths.forEach(d => params.append('depth', d));
        const values = ['Q0.5','Q0.05','Q0.95','mean','uncertainty'];
        values.forEach(v => params.append('value', v));
        const soilUrl = `https://rest.isric.org/soilgrids/v2.0/properties/query?${params.toString()}`;
        debug.soilgrids.url = soilUrl;
        debug.soilgrids.requestTime = new Date().toISOString();

        const doFetch = (attemptNum = 1) => {
          const timeout = 2000; // 60 seconds per attempt
          console.log(`🌱 SoilGrids fetch attempt ${attemptNum} (timeout: ${timeout}ms)...`);
          return axios.get(soilUrl, { 
            timeout, 
            headers: { accept: 'application/json' },
            validateStatus: (status) => status < 500, // Don't throw on 4xx, only 5xx
          });
        };
        
        let soilResp = null;
        let lastSoilError = null;
        const maxAttempts = 3;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const startTime = Date.now();
            soilResp = await doFetch(attempt);
            const elapsed = Date.now() - startTime;
            debug.soilgrids.attempt = attempt;
            debug.soilgrids.responseTime = elapsed;
            console.log(`✅ SoilGrids response received (attempt ${attempt}, ${elapsed}ms)`);
            
            if (soilResp.status >= 200 && soilResp.status < 300) {
              break; // Success
            } else {
              lastSoilError = new Error(`HTTP ${soilResp.status}: ${soilResp.statusText}`);
              console.warn(`⚠️  SoilGrids returned ${soilResp.status}, retrying...`);
              if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 2000 * attempt)); // Exponential backoff
                continue;
              }
            }
          } catch (e) {
            lastSoilError = e;
            const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.includes('timeout');
            const errorMsg = isTimeout ? `Timeout after ${e?.config?.timeout || 'unknown'}ms` : e.message;
            console.warn(`⚠️  SoilGrids fetch attempt ${attempt} failed: ${errorMsg}`);
            debug.soilgrids[`attempt${attempt}Error`] = errorMsg;
            
            if (attempt < maxAttempts) {
              const backoff = 2000 * attempt; // 2s, 4s, 6s
              console.log(`⏳ Retrying in ${backoff}ms...`);
              await new Promise(r => setTimeout(r, backoff));
            } else {
              console.error(`❌ SoilGrids failed after ${maxAttempts} attempts`);
              debug.soilgrids.finalError = errorMsg;
            }
          }
        }
        
        if (!soilResp || soilResp.status < 200 || soilResp.status >= 300) {
          throw lastSoilError || new Error('SoilGrids request failed after all retries');
        }
        debug.soilgrids.status = 200;
        const layers = soilResp.data?.properties?.layers || [];
        debug.soilgrids.layerCount = layers.length;
        debug.soilgrids.layerNames = layers.map(l => l?.name);
        debug.soilgrids.depthsByLayer = layers.reduce((acc, l) => {
          acc[l?.name] = Array.isArray(l?.depths) ? l.depths.map(d => d?.label) : [];
          return acc;
        }, {});
        const phPick = pickLayerValue(layers, 'phh2o');
        const clayPick = pickLayerValue(layers, 'clay');
        const sandPick = pickLayerValue(layers, 'sand');
        const siltPick = pickLayerValue(layers, 'silt');
        const socPick = pickLayerValue(layers, 'soc');
        debug.soilgrids.chosen = {
          phh2o: phPick,
          clay: clayPick,
          sand: sandPick,
          silt: siltPick,
          soc: socPick,
        };
        const ph = phPick.value; // pH
        const clayPct = clayPick.value; // %
        const sandPct = sandPick.value; // %
        const siltPct = siltPick.value; // %
        const soc_g_per_kg = socPick.value; // g/kg
        soil = {
          ph,
          clay_percent: clayPct,
          sand_percent: sandPct,
          silt_percent: siltPct,
          soil_organic_carbon: soc_g_per_kg,
          depth: '0-5cm',
        };
      } catch (e) {
        soil = null;
        const errorMsg = e?.message || String(e);
        debug.soilgrids.error = errorMsg;
        debug.soilgrids.errorCode = e?.code;
        debug.soilgrids.errorStack = e?.stack?.split('\n').slice(0, 3).join(' | ');
        console.error('❌ SoilGrids fetch failed:', errorMsg);
        // Continue without soil data - advisory will still be generated
      }
    }

    // Simple soil score heuristic
    const ph = soil?.ph;
    const soc = soil?.soil_organic_carbon; // g/kg
    const clay = soil?.clay_percent;
    let soil_score = null;
    if (typeof ph === 'number') {
      const dist = Math.abs(ph - 6.8);
      soil_score = Math.max(0, 100 - dist * 20);
    }
    // fallback: use SOC
    if (soil_score === null && typeof soc === 'number') {
      // Map SOC% (approx) to score: 0% -> 30, 1% -> 60, 2% -> 80, >=3% -> 95
      const socScore = soc >= 3 ? 95 : soc >= 2 ? 80 : soc >= 1 ? 60 : Math.max(30, soc * 60);
      soil_score = Math.round(socScore);
    }
    // slight adjustment with clay if available
    if (soil_score !== null && typeof clay === 'number') {
      const adj = clay > 40 ? -5 : clay < 15 ? -2 : 0;
      soil_score = Math.max(0, Math.min(100, soil_score + adj));
    }

    const month = new Date().getUTCMonth() + 1;
    const approxSeason = (m => (m>=10||m<=3)?'Rabi':(m>=4&&m<=6)?'Zaid':'Kharif')(month);

    // Use a separate Gemini key for soil advisory
    const GEMINI_SOIL_API_KEY = process.env.GEMINI_SOIL_API_KEY;
    if (!GEMINI_SOIL_API_KEY) {
      return res.status(501).json({ error: 'GEMINI_SOIL_API_KEY not configured in environment variables' });
    }
    const YT_API_KEY = process.env.YT_API_KEY || 'AIzaSyC0V4gZHxvCp18FW-6QQcIpkogTz7DKmsw';

    const languageName = userLanguage === 'hi' ? 'Hindi' : 'English';
    // Parse extracted text from soil health card if provided
    let parsedSoilParams = null;
    if (extractedText && hasSoilHealthCard) {
      try {
        // Try to extract key parameters from the text
        // Common patterns: pH: 6.5, Nitrogen: 80%, etc.
        const phMatch = extractedText.match(/pH[:\s]*([0-9.]+)/i);
        const nitrogenMatch = extractedText.match(/Nitrogen[:\s]*([0-9.]+)/i);
        const phosphorusMatch = extractedText.match(/Phosphorus[:\s]*([0-9.]+)/i);
        const potassiumMatch = extractedText.match(/Potassium[:\s]*([0-9.]+)/i);
        const moistureMatch = extractedText.match(/Moisture[:\s]*([0-9.]+)/i);
        
        parsedSoilParams = {
          ph: phMatch ? parseFloat(phMatch[1]) : null,
          nitrogen: nitrogenMatch ? parseFloat(nitrogenMatch[1]) : null,
          phosphorus: phosphorusMatch ? parseFloat(phosphorusMatch[1]) : null,
          potassium: potassiumMatch ? parseFloat(potassiumMatch[1]) : null,
          moisture: moistureMatch ? parseFloat(moistureMatch[1]) : null,
        };
        
        // Update soil data with extracted values if available
        if (parsedSoilParams.ph !== null) {
          soil = soil || {};
          soil.ph = parsedSoilParams.ph;
        }
        if (parsedSoilParams.nitrogen !== null) {
          soil = soil || {};
          soil.nitrogen = parsedSoilParams.nitrogen;
        }
        if (parsedSoilParams.phosphorus !== null) {
          soil = soil || {};
          soil.phosphorus = parsedSoilParams.phosphorus;
        }
        if (parsedSoilParams.potassium !== null) {
          soil = soil || {};
          soil.potassium = parsedSoilParams.potassium;
        }
        
        console.log('✅ Parsed soil parameters from card:', parsedSoilParams);
      } catch (parseError) {
        console.warn('⚠️ Failed to parse extracted text:', parseError.message);
      }
    }

    const prompt = `You are a soil health expert for Indian agriculture. Given the soil and seasonal context, provide:
1) A soil health score justification
2) Biofertilizer and organic amendments plan (dosage, timing, method)
3) A weekly improvement plan for 4 weeks
4) 5 YouTube search queries tailored to this field for learning resources
Respond as JSON only.

CONTEXT:
Location: lat ${lat ?? 'N/A'}, lon ${lon ?? 'N/A'}
Season: ${approxSeason}
Soil (0-5cm): ${soil ? JSON.stringify(soil) : 'N/A'}
${extractedText && hasSoilHealthCard ? `\nSOIL HEALTH CARD DATA (Extracted Text):\n${extractedText}\n\nParsed Parameters: ${parsedSoilParams ? JSON.stringify(parsedSoilParams) : 'N/A'}\n` : ''}
Language: ${languageName}

JSON shape:
{
  "soil_health_score": 0-100,
  "score_explanation": "",
  "bio_fertilizer_guidance": [ {"type":"", "dosage":"", "timing":"", "method":"", "benefits":""} ],
  "improvement_plan": [ {"week":1, "actions":["",""]} ],
  "youtube_queries": ["query1","query2","query3","query4","query5"]
}`;

    let gemResp;
    try {
      const { data: aiData, modelUsed } = await callGeminiGenerateContent(
        GEMINI_SOIL_API_KEY,
        { contents: [{ parts: [{ text: prompt }] }] },
        { timeout: 30000 }
      );
      debug.gemini = { model: modelUsed, promptLength: prompt.length };
      gemResp = { data: aiData };
    } catch (e) {
      debug.gemini.error = e.message;
      return res.status(502).json({ error: 'Gemini soil advisory failed', message: e.message, debug });
    }

    const text = gemResp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let advisory;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      advisory = JSON.parse(m ? m[0] : text);
    } catch (e) {
      advisory = { soil_health_score: soil_score ?? null, score_explanation: 'Could not parse AI response', youtube_queries: [] };
      debug.gemini.parseError = e.message;
    }

    // YouTube search
    const queries = Array.isArray(advisory.youtube_queries) ? advisory.youtube_queries.slice(0, 3) : [];
    const videos = [];
    for (const q of queries) {
      try {
        const ytUrl = `https://www.googleapis.com/youtube/v3/search?key=${YT_API_KEY}&part=snippet&type=video&maxResults=3&q=${encodeURIComponent(q)}`;
        const ytResp = await axios.get(ytUrl, { timeout: 10000 });
        if (!debug.youtube.requests) debug.youtube.requests = [];
        debug.youtube.requests.push({ q, url: ytUrl.replace(YT_API_KEY, '***'), status: 200, count: (ytResp.data?.items || []).length });
        (ytResp.data?.items || []).forEach(item => {
          videos.push({
            videoId: item.id?.videoId,
            title: item.snippet?.title,
            channelTitle: item.snippet?.channelTitle,
            publishedAt: item.snippet?.publishedAt,
            thumbnail: item.snippet?.thumbnails?.medium?.url,
            url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : null,
            query: q,
          });
        });
      } catch (e) {
        if (!debug.youtube.errors) debug.youtube.errors = [];
        debug.youtube.errors.push({ q, error: e.message });
      }
    }

    console.log('🧪 SOIL API result:', { hasSoil: !!soil, soil_score, videos: videos.length, language: userLanguage });
    res.json({ ok: true, advisory, soil, soil_score, season: approxSeason, videos, debug });
  } catch (error) {
    console.error('Error generating soil advisory:', error);
    res.status(500).json({ error: 'Failed to generate soil advisory', message: error.message });
  }
});

// GET /api/v1/reports - Get report for a field
app.get('/api/v1/reports', async (req, res) => {
  try {
    const { field_ID, farmer_ID } = req.query;
    
    if (!field_ID) {
      return res.status(400).json({ error: 'field_ID is required' });
    }
    
    if (!farmer_ID) {
      return res.status(400).json({ error: 'farmer_ID is required' });
    }
    
    console.log('📥 Fetching report for field:', { field_ID, farmer_ID });
    
    // Fetch from user's reports subcollection (most recent completed report)
    const reportsRef = db.collection('users').doc(farmer_ID).collection('reports');
    
    // Query for reports matching field_ID, ordered by most recent
    let snapshot;
    let orderError = null;
    try {
      snapshot = await reportsRef
        .where('field_ID', '==', field_ID)
        .orderBy('generated_at', 'desc')
        .limit(1)
        .get();
    } catch (error) {
      // Fallback: get all and filter in memory
      orderError = error;
      console.warn('OrderBy failed, filtering in memory:', error.message);
      snapshot = await reportsRef.get();
    }
    
    const reports = [];
    snapshot.forEach((doc) => {
      const reportData = doc.data();
      // Filter by field_ID if orderBy wasn't used
      if (!orderError || reportData.field_ID === field_ID) {
        reports.push({
          id: doc.id,
          ...reportData,
        });
      }
    });
    
    // Sort by generated_at if orderBy wasn't used
    if (orderError) {
      reports.sort((a, b) => {
        const aTime = a.generated_at?.toMillis?.() || a.generated_at || 0;
        const bTime = b.generated_at?.toMillis?.() || b.generated_at || 0;
        return bTime - aTime;
      });
    }
    
    if (reports.length === 0) {
      return res.status(404).json({ 
        error: 'No report found for this field',
        field_ID,
      });
    }
    
    const report = reports[0];
    
    // Convert Firestore timestamps to ISO strings for JSON response
    const formattedReport = {
      ...report,
      generated_at: report.generated_at?.toDate?.()?.toISOString() || report.generated_at,
    };
    
    console.log('✅ Report found:', { report_id: report.id, field_ID });
    
    res.json({ report: formattedReport, ok: true });
  } catch (error) {
    console.error('Error fetching report:', error);
    res.status(500).json({ error: 'Failed to fetch report', message: error.message });
  }
});

// GET /api/v1/market-prices - Fetch today's best price and last 10 records for a commodity/location
app.get('/api/v1/market-prices', async (req, res) => {
  try {
    const { commodity, state, district, market, date, limit = 10 } = req.query;
    if (!commodity) return res.status(400).json({ error: 'commodity is required' });

    const API_KEY = process.env.DATA_GOV_API_KEY;
    const RESOURCE_ID = process.env.DATA_GOV_RESOURCE_ID; // current daily prices dataset

    if (!API_KEY || !RESOURCE_ID) {
      return res.status(501).json({ 
        error: 'DATA_GOV_IN not configured', 
        message: 'Set DATA_GOV_API_KEY and DATA_GOV_RESOURCE_ID in server env', 
      });
    }

    // Helper to call data.gov.in with given filters using filters[field]=value format
    const baseUrl = 'https://api.data.gov.in/resource/' + encodeURIComponent(RESOURCE_ID);
    const fetchWith = async (flt, desired = 100) => {
      const sp = new URLSearchParams();
      sp.append('api-key', API_KEY);
      sp.append('format', 'json');
      sp.append('limit', String(Math.max(1, Math.min(100, Number(desired) || 100))));
      Object.entries(flt).forEach(([k, v]) => {
        if (v != null && `${v}`.trim().length > 0) sp.append(`filters[${k}]`, `${v}`);
      });
      const url = `${baseUrl}?${sp.toString()}`;
      const t0 = Date.now();
      const r = await axios.get(url, { timeout: 20000 });
      return { url, elapsed: Date.now() - t0, records: r.data?.records || r.data?.data || [] };
    };

    // Progressive relaxation of filters to gather enough data
    const attempts = [];
    attempts.push({ commodity, state, district, market, arrival_date: date });
    attempts.push({ commodity, state, district, arrival_date: date });
    attempts.push({ commodity, state, arrival_date: date });
    attempts.push({ commodity, arrival_date: date });
    attempts.push({ commodity, state, district, market });
    attempts.push({ commodity, state, district });
    attempts.push({ commodity, state });
    attempts.push({ commodity });

    let all = [];
    let urlUsed = null;
    let elapsed = 0;
    for (const flt of attempts) {
      const { url, elapsed: ms, records } = await fetchWith(flt, 100);
      urlUsed = url;
      elapsed += ms;
      all = all.concat(records || []);
      if (all.length >= 10) break;
    }

    // Normalize and sort (latest first by date where available)
    const normalized = all.map((rec) => {
      const dateStr = rec.arrival_date || rec.date || rec.timestamp || null;
      const date = dateStr ? new Date(dateStr) : null;
      const modal = Number(rec.modal_price || rec.modal || rec.price || rec.max_price || 0);
      return {
        date: date ? date.toISOString().slice(0, 10) : null,
        market: rec.market || rec.mandi || null,
        district: rec.district || null,
        state: rec.state || null,
        commodity: rec.commodity || commodity,
        variety: rec.variety || null,
        min_price: rec.min_price ? Number(rec.min_price) : null,
        max_price: rec.max_price ? Number(rec.max_price) : null,
        modal_price: Number.isFinite(modal) ? modal : null,
      };
    }).filter(x => x.modal_price != null);

    normalized.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const last10 = normalized.slice(0, Math.min(Number(limit) || 10, normalized.length));
    const todayStr = new Date().toISOString().slice(0, 10);
    const todays = normalized.filter(x => x.date === todayStr);
    const bestToday = todays.reduce((best, x) => (best == null || (x.modal_price ?? 0) > (best.modal_price ?? 0)) ? x : best, null);

    res.json({ ok: true, source: 'data.gov.in', url: urlUsed, elapsed_ms: elapsed, best_today: bestToday, last10 });
  } catch (error) {
    console.error('Error fetching market prices:', error.message);
    res.status(500).json({ error: 'Failed to fetch market prices', message: error.message });
  }
});

// GET /api/v1/market-prices/predict - Compute predicted sell date from last 10 prices
app.get('/api/v1/market-prices/predict', async (req, res) => {
  try {
    const { commodity, state, district, market } = req.query;
    if (!commodity) return res.status(400).json({ error: 'commodity is required' });

    // Reuse the previous endpoint to get last10
    const base = `${req.protocol}://${req.get('host')}`;
    const { data } = await axios.get(`${base}/api/v1/market-prices`, { params: { commodity, state, district, market, limit: 30 }, timeout: 30000 });
    const last10 = (data?.last10 || []).slice().reverse(); // oldest -> newest for regression

    if (last10.length < 3) {
      return res.json({ ok: true, message: 'Not enough data for prediction', last10, predicted_sell_date: null });
    }

    // Simple linear regression on index vs modal_price
    const n = last10.length;
    const xs = last10.map((_, i) => i + 1);
    const ys = last10.map(p => Number(p.modal_price));
    const sumX = xs.reduce((a,b)=>a+b,0);
    const sumY = ys.reduce((a,b)=>a+b,0);
    const sumXY = xs.reduce((a,b,i)=>a + b * ys[i], 0);
    const sumX2 = xs.reduce((a,b)=>a + b*b, 0);
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;

    // Predict next 7 days and pick peak day as suggested sell date
    const today = new Date();
    let best = { date: null, price: -Infinity };
    for (let d = 1; d <= 7; d++) {
      const x = n + d;
      const y = slope * x + intercept;
      const dt = new Date(today.getTime() + d * 86400000);
      if (y > best.price) best = { date: dt.toISOString().slice(0,10), price: Math.round(y) };
    }

    res.json({ ok: true, method: 'linear_regression', slope, intercept, last10: data.last10, best_today: data.best_today, predicted_sell_date: best });
  } catch (error) {
    console.error('Error predicting sell date:', error.message);
    res.status(500).json({ error: 'Failed to predict sell date', message: error.message });
  }
});

// GET /api/v1/market-meta - List states, districts, markets for a commodity (from data.gov.in)
app.get('/api/v1/market-meta', async (req, res) => {
  try {
    const { commodity } = req.query;
    const API_KEY = process.env.DATA_GOV_API_KEY;
    const RESOURCE_ID = process.env.DATA_GOV_RESOURCE_ID;
    if (!API_KEY || !RESOURCE_ID) return res.status(501).json({ error: 'DATA_GOV_IN not configured' });
    const baseUrl = 'https://api.data.gov.in/resource/' + encodeURIComponent(RESOURCE_ID);
    const sp = new URLSearchParams();
    sp.append('api-key', API_KEY);
    sp.append('format', 'json');
    sp.append('limit', '1000');
    if (commodity) sp.append('filters[commodity]', commodity);
    const url = `${baseUrl}?${sp.toString()}`;
    const r = await axios.get(url, { timeout: 20000 });
    const rows = r.data?.records || [];
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean))).sort();
    const states = uniq(rows.map(x => x.state));
    const districts = uniq(rows.map(x => x.district));
    const markets = uniq(rows.map(x => x.market || x.mandi));
    res.json({ ok: true, states, districts, markets });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meta', message: error.message });
  }
});

// Test Google Translate API endpoint
app.get('/api/v1/translate/test', async (req, res) => {
  try {
    const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!GOOGLE_TRANSLATE_API_KEY) {
      return res.status(503).json({ 
        error: 'Google Translate API key not configured',
        configured: false,
      });
    }
    
    // Test with a simple translation
    try {
      const response = await axios.post(
        `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_TRANSLATE_API_KEY}`,
        {
          q: 'Hello',
          source: 'en',
          target: 'hi',
          format: 'text',
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      );
      
      const translatedText = response.data?.data?.translations?.[0]?.translatedText;
      return res.json({ 
        success: true,
        configured: true,
        testTranslation: translatedText,
        message: 'Google Translate API is working!',
      });
    } catch (apiError) {
      const status = apiError?.response?.status;
      const errorMsg = apiError?.response?.data?.error?.message || apiError.message;
      
      return res.status(503).json({ 
        success: false,
        configured: true,
        error: `API Error (${status}): ${errorMsg}`,
        message: status === 403 
          ? '403 Forbidden: Enable Cloud Translation API and billing in Google Cloud Console'
          : 'Translation API test failed',
      });
    }
  } catch (error) {
    return res.status(500).json({ 
      error: 'Test failed',
      message: error.message,
    });
  }
});

// Google Translate endpoint for translations
app.post('/api/v1/translate', async (req, res) => {
  try {
    const { text, targetLang, sourceLang = 'en' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    
    if (!targetLang) {
      return res.status(400).json({ error: 'Target language is required' });
    }
    
    const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!GOOGLE_TRANSLATE_API_KEY) {
      console.warn('⚠️ Google Translate API key not configured');
      return res.status(503).json({ error: 'Translation service not configured', translatedText: text });
    }
    
    // Don't translate if same language
    if (targetLang === sourceLang) {
      return res.json({ translatedText: text });
    }
    
    try {
      const response = await axios.post(
        `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_TRANSLATE_API_KEY}`,
        {
          q: text,
          source: sourceLang,
          target: targetLang,
          format: 'text',
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      );
      
      const translatedText = response.data?.data?.translations?.[0]?.translatedText || text;
      return res.json({ translatedText });
    } catch (apiError) {
      const status = apiError?.response?.status;
      const errorMsg = apiError?.response?.data?.error?.message || apiError.message;
      
      console.error(`❌ Google Translate API error (${status}):`, errorMsg);
      
      if (status === 403) {
        return res.status(503).json({ 
          error: 'Translation API access denied. Please check API key permissions and ensure Cloud Translation API is enabled.',
          translatedText: text,
          details: errorMsg,
        });
      }
      
      return res.status(503).json({ 
        error: 'Translation service unavailable', 
        translatedText: text,
        details: errorMsg,
      });
    }
  } catch (error) {
    console.error('❌ Translation endpoint error:', error);
    res.status(500).json({ error: 'Translation failed', translatedText: req.body?.text || '' });
  }
});

// Batch translate endpoint for translating entire translation objects
app.post('/api/v1/translate/batch', async (req, res) => {
  try {
    const { translations, targetLang, sourceLang = 'en' } = req.body;
    
    if (!translations || typeof translations !== 'object') {
      return res.status(400).json({ error: 'Translations object is required' });
    }
    
    if (!targetLang) {
      return res.status(400).json({ error: 'Target language is required' });
    }
    
    const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!GOOGLE_TRANSLATE_API_KEY) {
      return res.status(503).json({ error: 'Translation service not configured', translated: translations });
    }
    
    // Don't translate if same language
    if (targetLang === sourceLang) {
      return res.json({ translated: translations });
    }
    
    // Recursive translation function
    async function translateObject(obj) {
      const translated = {};
      let successCount = 0;
      let failCount = 0;
      const errors = [];
      
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          try {
            const response = await axios.post(
              `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_TRANSLATE_API_KEY}`,
              {
                q: value,
                source: sourceLang,
                target: targetLang,
                format: 'text',
              },
              {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000,
              }
            );
            const translatedText = response.data?.data?.translations?.[0]?.translatedText || value;
            translated[key] = translatedText;
            if (translatedText !== value) {
              successCount++;
            } else {
              failCount++;
            }
          } catch (error) {
            const status = error?.response?.status;
            const errorMsg = error?.response?.data?.error?.message || error.message;
            
            if (status === 403) {
              errors.push(`403 Forbidden for "${key}"`);
              // If we get 403, stop trying - API key issue
              if (errors.length === 1) {
                console.error(`❌ Google Translate API 403 Error - Stopping translation`);
                console.error(`❌ API Key may be invalid or Cloud Translation API not enabled`);
                console.error(`❌ Error: ${errorMsg}`);
                throw new Error(`Google Translate API 403: ${errorMsg || 'API key invalid or Cloud Translation API not enabled'}`);
              }
            } else {
              errors.push(`Error translating "${key}": ${errorMsg}`);
            }
            
            console.warn(`⚠️ Failed to translate "${key}":`, errorMsg || error.message);
            translated[key] = value; // Fallback to original
            failCount++;
          }
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          translated[key] = await translateObject(value);
          // Count nested translations
          const nestedCounts = countTranslations(translated[key]);
          successCount += nestedCounts.success;
          failCount += nestedCounts.fail;
        } else {
          translated[key] = value;
        }
      }
      
      // Log summary every 10 keys
      if ((successCount + failCount) % 10 === 0) {
        console.log(`📊 Translation progress: ${successCount} success, ${failCount} failed`);
      }
      
      return translated;
    }
    
    // Helper to count nested translations
    function countTranslations(obj) {
      let success = 0;
      let fail = 0;
      for (const value of Object.values(obj)) {
        if (typeof value === 'string') {
          fail++; // Count as fail since we can't determine if it was translated
        } else if (typeof value === 'object' && value !== null) {
          const counts = countTranslations(value);
          success += counts.success;
          fail += counts.fail;
        }
      }
      return { success, fail };
    }
    
    console.log(`🚀 Starting batch translation for ${targetLang}...`);
    try {
      const translated = await translateObject(translations);
      
      // Check if translation actually happened
      const sampleKey = Object.keys(translations)[0];
      const originalSample = translations[sampleKey];
      const translatedSample = translated[sampleKey];
      
      // If first translation is identical, likely all failed
      if (typeof originalSample === 'string' && typeof translatedSample === 'string' && originalSample === translatedSample) {
        console.warn(`⚠️ Warning: Translation appears to have failed - sample unchanged`);
        console.warn(`⚠️ Check Google Translate API key and permissions`);
        return res.status(503).json({ 
          error: 'Translation failed - API key may be invalid or Cloud Translation API not enabled',
          translated: translations, // Return original as fallback
        });
      }
      
      console.log(`✅ Batch translation completed for ${targetLang}`);
      return res.json({ translated });
    } catch (translateError) {
      console.error(`❌ Batch translation stopped due to error:`, translateError.message);
      return res.status(503).json({ 
        error: translateError.message || 'Translation failed',
        translated: translations, // Return original as fallback
        details: 'Check Google Cloud Console: Enable Cloud Translation API and ensure billing is enabled',
      });
    }
  } catch (error) {
    console.error('❌ Batch translation error:', error);
    res.status(500).json({ error: 'Batch translation failed', translated: req.body?.translations || {} });
  }
});

// Gemini Live API WebSocket endpoint
const GEMINI_LIVE_API_KEY = process.env.GEMINI_LIVE_API_KEY || 'AIzaSyADXSwTHK5zSYyeNwWBWFuqpMzgtJVs12s';
// Gemini Live API endpoint - correct format for bidirectional streaming
const GEMINI_LIVE_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_LIVE_API_KEY}`;

// WebSocket server for Gemini Live API
const wss = new WebSocketServer({ server, path: '/api/v1/gemini-live' });

wss.on('connection', (clientWs, req) => {
  console.log('🔌 Client WebSocket connected');
  
  let geminiWs = null;
  let isInitialized = false;
  
  // Parse query parameters for disease context
  const url = new URL(req.url, `http://${req.headers.host}`);
  const disease_label = url.searchParams.get('disease_label') || 'Unknown disease';
  const context = url.searchParams.get('context') || '';
  const language = url.searchParams.get('language') || 'en';
  
  const languageName = language === 'hi' ? 'Hindi' : language === 'en' ? 'English' : 'English';
  
  // System instruction/preprompt about the disease
  const systemInstruction = `You are an agriculture plant pathology expert helping a farmer with a detected disease.

DETECTED DISEASE: ${disease_label}
CONTEXT: ${context || 'No additional context'}

Your role:
- Provide immediate, actionable advice for smallholder farmers
- Focus on organic, safe solutions first
- Explain prevention measures
- If severe, recommend escalation steps
- Keep responses concise and practical
- Answer in ${languageName}

You are having a one-on-one conversation with the farmer. Listen carefully to their questions and provide helpful, empathetic guidance.`;

  // Connect to Gemini Live API
  const connectToGemini = () => {
    try {
      console.log('🔗 Connecting to Gemini Live API...');
      console.log('🔗 URL:', GEMINI_LIVE_URL.replace(/key=([^&]+)/, 'key=***'));
      
      geminiWs = new WebSocket(GEMINI_LIVE_URL);
      
      geminiWs.on('open', () => {
        console.log('✅ Connected to Gemini Live API');
        isInitialized = true;
        
        // Send initial setup message for Gemini Live API
        // Format based on Gemini Live API specification
        // Note: Native audio models use default voices, voice_name may not be supported
        const setupMessage = {
          setup: {
            model: 'models/gemini-2.5-flash-native-audio-preview-09-2025',
            generation_config: {
              response_modalities: ['AUDIO'],
              speech_config: {
                language_code: language === 'hi' ? 'hi-IN' : 'en-US'
              }
            },
            system_instruction: {
              parts: [{ text: systemInstruction }]
            }
          }
        };
        
        console.log('📤 Sending setup message to Gemini...');
        geminiWs.send(JSON.stringify(setupMessage));
        
        // Notify client that connection is ready
        setTimeout(() => {
          clientWs.send(JSON.stringify({ type: 'connected', message: 'Ready for live voice interaction' }));
        }, 500);
      });
      
      geminiWs.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log('📥 Gemini message type:', Object.keys(message)[0]);
          
          // Handle different message types from Gemini Live API
          if (message.server_content) {
            // Forward server content (text/audio responses)
            clientWs.send(JSON.stringify({
              type: 'response',
              data: message.server_content
            }));
            
            // Extract text from response
            if (message.server_content.model_turn?.parts) {
              for (const part of message.server_content.model_turn.parts) {
                if (part.text) {
                  console.log('📝 Gemini text response:', part.text.substring(0, 100));
                  clientWs.send(JSON.stringify({
                    type: 'text',
                    text: part.text
                  }));
                }
              }
            }
          }
          
          // Handle audio responses
          if (message.audio) {
            console.log('🔊 Received audio response from Gemini');
            console.log('🔊 Audio message structure:', {
              hasData: !!message.audio.data,
              dataType: typeof message.audio.data,
              dataLength: message.audio.data?.length,
              mimeType: message.audio.mime_type
            });
            
            // Check if audio data exists
            if (message.audio.data) {
              clientWs.send(JSON.stringify({
                type: 'audio',
                data: message.audio.data,
                mimeType: message.audio.mime_type || 'audio/pcm'
              }));
            } else {
              console.warn('⚠️ Audio message received but data is missing');
            }
          }
          
          // Also check for audio in server_content parts (alternative format)
          if (message.server_content?.model_turn?.parts) {
            for (const part of message.server_content.model_turn.parts) {
              if (part.inline_data && part.inline_data.data) {
                console.log('🔊 Found audio in inline_data');
                clientWs.send(JSON.stringify({
                  type: 'audio',
                  data: part.inline_data.data,
                  mimeType: part.inline_data.mime_type || 'audio/pcm'
                }));
              }
            }
          }
          
          // Handle interrupt events
          if (message.server_content?.interrupted) {
            console.log('⚠️ Gemini response was interrupted');
            clientWs.send(JSON.stringify({
              type: 'interrupted'
            }));
          }
        } catch (e) {
          console.error('❌ Error parsing Gemini message:', e);
          console.error('❌ Raw message:', data.toString().substring(0, 200));
        }
      });
      
      geminiWs.on('error', (error) => {
        console.error('❌ Gemini WebSocket error:', error);
        console.error('❌ Error details:', {
          message: error.message,
          code: error.code,
          stack: error.stack?.split('\n').slice(0, 5).join('\n')
        });
        // Don't close client connection on Gemini error - keep it alive
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ 
            type: 'error', 
            message: error.message || 'Gemini Live API error',
            details: `Code: ${error.code || 'UNKNOWN'}`,
            reconnect: true
          }));
        }
      });
      
      geminiWs.on('close', (code, reason) => {
        console.log('🔌 Gemini WebSocket closed', code, reason?.toString());
        
        // Reset initialization flag
        isInitialized = false;
        
        // Stop reconnecting loop if it's a permanent error
        if (code === 1007 && (reason?.toString().includes('not available') || reason?.toString().includes('Invalid'))) {
          console.error('❌ Permanent error - stopping reconnection attempts');
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ 
              type: 'error', 
              message: reason?.toString() || 'Configuration error',
              permanent: true
            }));
          }
          return;
        }
        
        // Don't close client connection immediately - try to reconnect for transient errors
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ 
            type: 'gemini_closed', 
            code, 
            reason: reason?.toString() || 'Unknown',
            message: 'Gemini connection closed, attempting to reconnect...'
          }));
          // Attempt to reconnect after a short delay (only for transient errors)
          setTimeout(() => {
            if (clientWs.readyState === WebSocket.OPEN) {
              console.log('🔄 Attempting to reconnect to Gemini...');
              connectToGemini();
            }
          }, 2000);
        }
      });
      
    } catch (error) {
      console.error('❌ Error connecting to Gemini:', error);
      console.error('❌ Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack?.split('\n').slice(0, 5).join('\n')
      });
      clientWs.send(JSON.stringify({ 
        type: 'error', 
        message: error.message || 'Failed to connect to Gemini Live API',
        details: `Code: ${error.code || 'UNKNOWN'}`
      }));
      // Don't close immediately - let client handle it
    }
  };
  
  // Handle messages from client (audio chunks)
  clientWs.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'audio' && geminiWs && isInitialized) {
        // Forward audio chunk to Gemini Live API
        // Format: Based on Gemini Live API - send parts directly with inline_data
        // Note: Gemini Live expects PCM format, but we're receiving m4a
        // For now, we'll send it as-is and let Gemini handle conversion
        // In production, you'd want to convert m4a to PCM using ffmpeg
        // Try simplest format first - just parts at root level
        const audioMessage = {
          parts: [{
            inline_data: {
              mime_type: 'audio/pcm;rate=16000', // PCM format for live streaming
              data: message.data
            }
          }]
        };
        
        const messageStr = JSON.stringify(audioMessage);
        console.log(`📤 Forwarding audio chunk ${message.chunkIndex || 0} to Gemini (${message.data.length} bytes)`);
        console.log(`📤 Audio message format:`, JSON.stringify(audioMessage).substring(0, 200));
        
        geminiWs.send(messageStr);
      } else if (message.type === 'init') {
        // Initialize connection
        connectToGemini();
      }
    } catch (error) {
      console.error('❌ Error handling client message:', error);
    }
  });
  
  clientWs.on('error', (error) => {
    console.error('❌ Client WebSocket error:', error);
  });
  
  // Send ping to keep connection alive
  const pingInterval = setInterval(() => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000); // Ping every 30 seconds
  
  clientWs.on('close', () => {
    console.log('🔌 Client WebSocket disconnected');
    clearInterval(pingInterval);
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close();
    }
  });
});

// Start server only if not in Vercel (serverless) environment
// Vercel uses serverless functions and doesn't need server.listen()
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
if (!isVercel) {
  server.listen(port, '0.0.0.0', async () => {
    // eslint-disable-next-line no-console
    console.log(`hal-api listening on http://0.0.0.0:${port}`);
    // eslint-disable-next-line no-console
    console.log(`WebSocket server available at ws://0.0.0.0:${port}/api/v1/gemini-live`);
    // eslint-disable-next-line no-console
    console.log(`Accessible via: http://localhost:${port} or your LAN IP:${port}`);
    
    // Start the worker in the same process (for local development)
    // Only start if not running in standalone worker mode
    if (process.env.RUN_WORKER_STANDALONE !== 'true') {
      try {
        const { workerLoop } = await import('./worker.js');
        console.log('🌱 Starting HAL Job Worker in combined mode...');
        workerLoop().catch((error) => {
          console.error('❌ Fatal error in worker:', error);
          // Don't exit the process - let the server keep running
        });
      } catch (error) {
        console.error('⚠️  Could not start worker:', error.message);
        console.error('   Worker will not be available, but server will continue running');
      }
    }
  });
} else {
  console.log('🚀 Running in Vercel serverless environment');
  // In Vercel, worker should be started separately or via scheduled functions
}

// Export for Vercel serverless functions
// Vercel will use this export when deploying
export default app;

