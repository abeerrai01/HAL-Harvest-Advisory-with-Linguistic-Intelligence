# Google Translate API 403 Error - Troubleshooting Guide

## Error: 403 Forbidden

A 403 error means the API request was rejected due to permission issues. Here's how to fix it:

## Common Causes & Solutions

### 1. **Cloud Translation API Not Enabled**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Navigate to "APIs & Services" > "Library"
   - Search for "Cloud Translation API"
   - Click "Enable" if it's not enabled

### 2. **Billing Not Enabled**
   - Google Cloud requires billing to be enabled even for free tier
   - Go to "Billing" in Google Cloud Console
   - Link a billing account (free tier still works, but billing must be enabled)

### 3. **API Key Restrictions**
   - Go to "APIs & Services" > "Credentials"
   - Click on your API key
   - Check "API restrictions":
     - Set to "Restrict key" → Make sure "Cloud Translation API" is selected
     - OR set to "Don't restrict key" (less secure but easier for testing)
   - Check "Application restrictions":
     - For mobile apps, you may need to remove IP/HTTP referrer restrictions
     - Or set to "None" for testing

### 4. **Invalid API Key**
   - Verify the API key is correct: `AIzaSyAK4hgAE7YhzZ076m8dKYbwodK6PcuPy60`
   - Make sure there are no extra spaces or characters
   - Regenerate the key if needed

### 5. **Quota Exceeded**
   - Check "APIs & Services" > "Dashboard"
   - Look for quota/usage limits
   - Free tier: 500,000 characters/month

## Quick Fix Steps

1. **Enable Cloud Translation API:**
   ```
   https://console.cloud.google.com/apis/library/translate.googleapis.com
   ```

2. **Enable Billing:**
   ```
   https://console.cloud.google.com/billing
   ```
   (Even free tier needs billing enabled)

3. **Check API Key Settings:**
   ```
   https://console.cloud.google.com/apis/credentials
   ```
   - Click on your API key
   - Under "API restrictions": Select "Cloud Translation API" or "Don't restrict key"
   - Under "Application restrictions": Set to "None" for testing

4. **Verify API Key:**
   - Make sure the key in `googleTranslate.js` matches your Google Cloud Console

## Testing API Key

You can test the API key directly with curl:

```bash
curl -X POST \
  "https://translation.googleapis.com/language/translate/v2?key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "q": "Hello",
    "source": "en",
    "target": "hi",
    "format": "text"
  }'
```

## Temporary Solution

If you want to disable Google Translate temporarily, the app will fall back to English:
- The app already handles this gracefully
- It will show English text instead of translated text
- No crashes or errors

## Alternative: Use Backend Translation

If API key issues persist, we can move translation to your backend (`hal-api`) where you have more control over API keys and error handling.

Let me know if you need help with any of these steps!

