# HAL API - Production Backend

Production-ready backend API for the HAL (Farmer Assistant) application, handling field management, job queuing, and crop health analysis.

## Features

- **Field Management**: Save and retrieve farmer field boundaries with 4-point polygon geometry
- **Job Queuing**: Asynchronous crop health analysis jobs with status tracking
- **Satellite Data Integration**: Real-time NDVI analysis from Sentinel Hub or Planet Labs
- **Weather Data Integration**: Current conditions and 5-day forecasts from OpenWeatherMap or WeatherAPI
- **AI Recommendations**: Intelligent crop health recommendations based on NDVI, weather, and historical data
- **Firebase Integration**: Secure data storage using Firestore

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory (use `.env.example` as a template):

```bash
cp .env.example .env
```


#### Weather API (Required for real weather data)
- `WEATHER_API_PROVIDER`: Provider choice - `openweathermap` or `weatherapi`
- `WEATHER_API_KEY`: Your API key from the chosen provider
- `WEATHER_API_URL`: API base URL (optional, defaults provided)

**OpenWeatherMap Setup:**
1. Sign up at https://openweathermap.org/api
2. Get your free API key (free tier: 60 calls/minute)
3. Set `WEATHER_API_PROVIDER=openweathermap`
4. Set `WEATHER_API_KEY=your_openweathermap_key`

**WeatherAPI.com Setup:**
1. Sign up at https://www.weatherapi.com/
2. Get your free API key (free tier: 1 million calls/month)
3. Set `WEATHER_API_PROVIDER=weatherapi`
4. Set `WEATHER_API_KEY=your_weatherapi_key`

#### Worker Configuration (Optional)
- `WORKER_POLL_INTERVAL_MS`: How often worker checks for new jobs (default: 5000ms)
- `MAX_CONCURRENT_JOBS`: Maximum jobs processed simultaneously (default: 3)
- `API_TIMEOUT_MS`: Timeout for external API calls (default: 30000ms)

### 3. Firebase Service Account

Place your Firebase service account key at:
```
hal-api/serviceAccountKey.json
```

The service account key should have Firestore read/write permissions.

### 4. Start the Server

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

### 5. Start the Worker (Separate Process)

The worker processes jobs asynchronously. Run it in a separate terminal:

**Development mode:**
```bash
npm run dev:worker
```

**Production mode:**
```bash
npm run worker
```

For production deployments, consider using:
- PM2 for process management
- Docker containers
- Kubernetes jobs
- AWS Lambda / Cloud Functions (with modifications)

## API Endpoints

### Fields

- `GET /api/v1/fields?farmer_ID={uid}` - Get all fields for a farmer
- `POST /api/v1/fields` - Create a new field
  ```json
  {
    "farmer_ID": "user-uid",
    "field_name": "North Field",
    "geometry": [[lat1, lon1], [lat2, lon2], [lat3, lon3], [lat4, lon4]]
  }
  ```

### Jobs

- `POST /api/v1/jobs` - Create a new analysis job
  ```json
  {
    "field_ID": "field-name",
    "farmer_ID": "user-uid",
    "job_type": "CROP_HEALTH_ANALYSIS"
  }
  ```
  Returns: `202 Accepted` with `job_id`

- `GET /api/v1/jobs?farmer_ID={uid}` - Get all jobs for a farmer
- `GET /api/v1/jobs?field_ID={field_id}&farmer_ID={uid}` - Get jobs for a specific field
- `GET /api/v1/jobs/:job_id` - Get specific job status

## Data Storage

### Firestore Structure

```
users/
  {farmer_ID}/
    fields/
      {field_name}/
        lat1, lon1, lat2, lon2, lat3, lon3, lat4, lon4
        createdAt
    jobs/
      {job_ID}/
        job_ID, field_ID, farmer_ID, job_type
        status (PENDING/PROCESSING/COMPLETED/FAILED)
        requested_at, updated_at
    reports/
      {report_ID}/
        field_ID, job_ID
        ndvi_analysis, weather_data, recommendations
        generated_at

jobs/
  {job_ID}/
    (Same structure as user/jobs for global access)
```

## Production Deployment

### Environment Variables Checklist

Before deploying to production:

- [ ] `NODE_ENV=production`
- [ ] `SATELLITE_API_KEY` is set (required for real data)
- [ ] `WEATHER_API_KEY` is set (required for real data)
- [ ] `PORT` is set (or uses default 5050)
- [ ] Firebase service account key is securely stored
- [ ] Worker process is configured to run separately
- [ ] API rate limits are configured appropriately

### Mock Data Fallback

If API keys are not configured, the system will automatically fall back to mock data:
- Mock satellite data: Returns sample NDVI values
- Mock weather data: Returns sample forecast data

**Warning**: Mock data is only for development/testing. Production deployments should use real API keys.

## Troubleshooting

### Worker not processing jobs

1. Check that the worker process is running: `npm run worker`
2. Verify Firebase Admin is initialized (check logs)
3. Ensure jobs are being created with `status: "PENDING"`
4. Check worker logs for error messages

### API calls failing

1. Verify API keys are set correctly in `.env`
2. Check API rate limits haven't been exceeded
3. Verify network connectivity
4. Check API provider status pages

### Firestore errors

1. Verify `serviceAccountKey.json` is in the correct location
2. Check service account has Firestore permissions
3. Verify Firestore rules allow the operations

## License

Private - HAL Application
