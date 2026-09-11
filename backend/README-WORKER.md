# HAL API Worker Setup

## Problem: Worker Not Processing Jobs

**Issue:** Jobs are queued successfully but remain in PENDING status.

**Root Cause:** The worker process is not running.

## Solution: Start the Worker

The worker is a separate process that polls Firestore for PENDING jobs and processes them. You need to run it in a separate terminal window.

### Start the Worker

```bash
cd hal-api
npm run dev:worker
```

### Expected Output

When the worker starts, you should see:
```
✅ Worker: Firebase Admin initialized
🌱 HAL Job Worker Starting...
👷 Worker started - Polling for PENDING jobs...
⚙️  Configuration: {
  poll_interval_ms: 5000,
  max_concurrent_jobs: 3,
  satellite_provider: 'sentinel_hub',
  weather_provider: 'openweathermap',
  satellite_api_configured: true,
  weather_api_configured: true
}
```

When a job is found:
```
📋 Found 1 PENDING job(s)
🔄 Queuing job for processing: job-xxx (field: F)
🚀 Starting job processing: job-xxx
📍 Fetching field data for: F
📡 Making parallel API calls...
```

## Sentinel Hub API Setup

The worker now uses **Sentinel Hub API** (not Planet Labs).

### Get Your Sentinel Hub OAuth Token

1. Go to [Sentinel Hub Dashboard](https://shapps.dataspace.copernicus.eu/dashboard/#/home)
2. Navigate to **OAuth Clients** or **API Credentials**
3. Create an OAuth client or get your existing token
4. Copy the OAuth2 Bearer token

### Update .env File

Edit `.env` and set:
```env
SATELLITE_API_PROVIDER=sentinel_hub
SATELLITE_API_KEY=YOUR_OAUTH2_TOKEN_HERE
SATELLITE_API_URL=https://services.sentinel-hub.com/api/v1
```

**Important:** Replace `YOUR_OAUTH2_TOKEN_HERE` with your actual Sentinel Hub OAuth2 Bearer token.

### Documentation

- [Sentinel Hub API Reference](https://docs.sentinel-hub.com/api/latest/reference/)
- [Sentinel Hub Authentication](https://docs.sentinel-hub.com/api/latest/api/overview/authentication/)

## Running Both Server and Worker

You need **two terminal windows**:

**Terminal 1 - API Server:**
```bash
cd hal-api
npm run dev
```

**Terminal 2 - Worker:**
```bash
cd hal-api
npm run dev:worker
```

## Monitoring

The worker logs every action:
- When polling for jobs
- When jobs are found
- Processing steps
- API calls
- Errors (with detailed information)

Check the worker terminal for real-time processing updates.

