# Google Translate Integration Guide

## Overview
This guide explains how to integrate Google Translate API for automatic translations while keeping manual translations for English and Hindi.

## Implementation Options

### Option 1: Hybrid Approach (Recommended) ✅
- **Manual translations**: English & Hindi (high quality)
- **Google Translate**: All other languages (Tamil, Telugu, Bengali, etc.)
- **Pros**: Best of both worlds - quality where needed, automation for others
- **Cons**: Requires API key and internet connection

### Option 2: Full Manual Translations
- Translate everything manually
- **Pros**: Highest quality, no API costs
- **Cons**: Time-consuming, hard to maintain

### Option 3: Full Google Translate
- Use Google Translate for all languages
- **Pros**: Easy to add new languages
- **Cons**: Lower quality, especially for domain-specific terms

## Setup Instructions

### Step 1: Get Google Translate API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable **Cloud Translation API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Cloud Translation API"
   - Click "Enable"
4. Create credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy your API key

### Step 2: Add API Key to Environment

Add to your `.env` file:
```env
EXPO_PUBLIC_GOOGLE_TRANSLATE_API_KEY=your_api_key_here
```

### Step 3: Install Dependencies (if needed)

The implementation uses native `fetch`, so no additional packages are required.

### Step 4: Usage

The Google Translate service is already set up in `services/googleTranslate.js`. 

**Current behavior:**
- English & Hindi: Uses manual translations (from `translations.js`)
- Other languages: Falls back to English (can be enhanced to use Google Translate)

**To enable Google Translate for other languages**, you can:

1. **Pre-translate on app load** (recommended):
```javascript
// In i18n.js, when language changes
useEffect(() => {
  if (!MANUAL_TRANSLATION_LANGUAGES.includes(language)) {
    preloadTranslations(language);
  }
}, [language]);
```

2. **Translate on-demand** (current implementation):
   - Already set up in `googleTranslate.js`
   - Can be called when needed

## Cost Estimation

Google Translate API pricing (as of 2024):
- **Free tier**: 500,000 characters/month
- **Paid**: $20 per million characters

**Example:**
- Your app has ~500 translation keys
- Average ~20 characters per key = ~10,000 characters per language
- For 10 languages = ~100,000 characters
- **Cost**: FREE (within free tier)

## Quality Considerations

### When Google Translate Works Well:
- ✅ Simple UI text ("Login", "Save", "Cancel")
- ✅ Common phrases
- ✅ Basic instructions

### When Manual Translation is Better:
- ❌ Domain-specific terms ("NDVI", "Bio-fertilizer")
- ❌ Agricultural terminology
- ❌ Cultural context
- ❌ Brand names

### Recommended Approach:
1. Keep English & Hindi manual (you already have this)
2. Use Google Translate for other languages
3. Review and manually fix critical terms if needed
4. Cache translations to reduce API calls

## Implementation Status

✅ **Created**: `services/googleTranslate.js` - Google Translate service
✅ **Updated**: `services/i18n.js` - Ready for integration
⏳ **Pending**: Enable Google Translate in the `t()` function (currently falls back to English)

## Next Steps

1. Add API key to `.env`
2. Test with one language (e.g., Tamil)
3. Monitor API usage
4. Add caching for better performance
5. Optionally pre-translate common strings on app load

## Example Usage

```javascript
import { translateText } from './services/googleTranslate';

// Translate a single string
const translated = await translateText('Hello', 'ta', 'en');
// Returns: "வணக்கம்"

// Translate an object
import { translateObject } from './services/googleTranslate';
const translatedObj = await translateObject({ 
  title: 'Welcome', 
  subtitle: 'Get started' 
}, 'ta', 'en');
```

## Notes

- Translations are cached in memory and AsyncStorage
- API calls are only made when cache miss occurs
- Falls back to English if API fails
- No breaking changes to existing code

