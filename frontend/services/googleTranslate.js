import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './halApi';

// Languages that have manual translations (don't use Google Translate)
const MANUAL_TRANSLATION_LANGUAGES = ['en', 'hi'];

// Cache for translations to avoid repeated API calls
const translationCache = new Map();

/**
 * Translate text using Google Translate API
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code (e.g., 'ta', 'te', 'bn')
 * @param {string} sourceLang - Source language code (default: 'en')
 * @returns {Promise<string>} Translated text
 */
export async function translateText(text, targetLang, sourceLang = 'en') {
  // Don't translate if target is same as source
  if (targetLang === sourceLang) {
    return text;
  }

  // Don't use Google Translate for manually translated languages
  if (MANUAL_TRANSLATION_LANGUAGES.includes(targetLang)) {
    return text;
  }

  // Check cache first
  const cacheKey = `${sourceLang}_${targetLang}_${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // Check AsyncStorage cache
  try {
    const cached = await AsyncStorage.getItem(`translate_${cacheKey}`);
    if (cached) {
      translationCache.set(cacheKey, cached);
      return cached;
    }
  } catch (error) {
    console.warn('Failed to read translation cache:', error);
  }

  // Use backend translation endpoint (more secure - API key stays on backend)
  try {
    const response = await api.post('/api/v1/translate', {
      text,
      targetLang,
      sourceLang,
    }, {
      timeout: 10000,
    });
    
    const translatedText = response.data?.translatedText || text;

    // Cache the translation
    translationCache.set(cacheKey, translatedText);
    try {
      await AsyncStorage.setItem(`translate_${cacheKey}`, translatedText);
    } catch (error) {
      console.warn('Failed to cache translation:', error);
    }

    return translatedText;
  } catch (error) {
    const errorMsg = error?.response?.data?.error || error?.message || 'Unknown error';
    const errorDetails = error?.response?.data?.details;
    
    console.error('Google Translate error:', errorMsg);
    if (errorDetails) {
      console.error('Error details:', errorDetails);
    }
    
    // Return original text on error (graceful fallback)
    return text;
  }
}

/**
 * Translate an object recursively (for nested translation objects)
 * @param {object} obj - Object to translate
 * @param {string} targetLang - Target language code
 * @param {string} sourceLang - Source language code
 * @returns {Promise<object>} Translated object
 */
export async function translateObject(obj, targetLang, sourceLang = 'en') {
  if (targetLang === sourceLang || MANUAL_TRANSLATION_LANGUAGES.includes(targetLang)) {
    return obj;
  }

  try {
    console.log(`📤 Sending batch translation request to backend...`);
    console.log(`📊 Object to translate:`, {
      topLevelKeys: Object.keys(obj).length,
      targetLang,
      sourceLang,
    });
    
    // Use backend batch translation endpoint
    const response = await api.post('/api/v1/translate/batch', {
      translations: obj,
      targetLang,
      sourceLang,
    }, {
      timeout: 120000, // 2 minutes timeout for batch translation
    });
    
    // Check if backend returned an error
    if (response.status === 503 || response.data?.error) {
      const errorMsg = response.data?.error || 'Translation service unavailable';
      console.error('❌ Backend returned error:', errorMsg);
      throw new Error(errorMsg);
    }
    
    const translated = response.data?.translated || obj;
    
    console.log(`📥 Received batch translation response:`, {
      hasData: !!response.data,
      hasTranslated: !!translated,
      translatedKeys: Object.keys(translated || {}).length,
      hasError: !!response.data?.error,
    });
    
    // Verify we got a proper translation
    if (!translated || Object.keys(translated).length === 0) {
      throw new Error('Backend returned empty translation');
    }
    
    // Verify translation actually happened by comparing a sample
    const sampleKey = Object.keys(obj)[0];
    const originalSample = obj[sampleKey];
    const translatedSample = translated[sampleKey];
    
    // If sample is unchanged, translation likely failed
    if (typeof originalSample === 'string' && typeof translatedSample === 'string' && originalSample === translatedSample) {
      console.warn(`⚠️ Translation appears unchanged - sample key "${sampleKey}" unchanged`);
      throw new Error('Translation failed - text appears unchanged (API may have returned original)');
    }
    
    return translated;
  } catch (error) {
    const errorMsg = error?.response?.data?.error || error?.message || 'Unknown error';
    const errorDetails = error?.response?.data?.details;
    const status = error?.response?.status;
    
    console.error('❌ Batch translation error:', {
      message: errorMsg,
      details: errorDetails,
      status: status,
      fullError: error,
    });
    
    // Log backend connectivity
    if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
      console.error('⚠️ Translation timeout - backend may be slow or unreachable');
    } else if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('Network Error')) {
      console.error('⚠️ Network error - backend may not be accessible');
    } else if (status === 503) {
      console.error('⚠️ Backend translation service unavailable - check Google Translate API key');
    }
    
    // Return original object on error (graceful fallback)
    return obj;
  }
}

/**
 * Clear translation cache
 */
export function clearTranslationCache() {
  translationCache.clear();
}

