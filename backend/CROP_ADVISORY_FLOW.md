# 📊 Crop Advisory - Complete Flow Documentation

## 🎯 Overview

The Crop Advisory feature is a comprehensive system that helps farmers:
1. **Setup fields** by drawing boundaries on a map
2. **Analyze crop health** using satellite imagery (NDVI) and weather data
3. **Receive AI-powered recommendations** for irrigation, fertilization, and field management

---

## 🔄 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CROP ADVISORY FLOW                              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: INITIAL SETUP (First Time Users)                              │
└─────────────────────────────────────────────────────────────────────────┘

1. User opens Crop Advisory Screen
   │
   ├─> CropAdvisoryToggle.jsx renders
   │   │
   │   ├─> useEffect() triggers checkFields()
   │   │   │
   │   │   ├─> Check if user is authenticated (auth.currentUser)
   │   │   │
   │   │   ├─> API Call: GET /api/v1/fields?farmer_ID={uid}
   │   │   │   │
   │   │   │   └─> Backend (server.js)
   │   │   │       │
   │   │   │       ├─> Query Firestore: users/{uid}/fields/*
   │   │   │       │
   │   │   │       └─> Return: { fields: [...], ok: true }
   │   │   │
   │   │   └─> Set state: hasFields = (fields.length > 0)
   │   │
   │   └─> Conditional Rendering:
   │       │
   │       ├─> IF hasFields === false
   │       │   └─> Render FieldSetup.jsx
   │       │
   │       └─> IF hasFields === true
   │           └─> Render CropAdvisory1.jsx

┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: FIELD SETUP (FieldSetup.jsx)                                  │
└─────────────────────────────────────────────────────────────────────────┘

2. FieldSetup Screen Interaction
   │
   ├─> On Mount:
   │   │
   │   └─> getCurrentLocation()
   │       │
   │       ├─> Request location permissions (expo-location)
   │       │
   │       ├─> Get GPS coordinates (latitude, longitude)
   │       │
   │       └─> Center map on user's location
   │
   ├─> User Interaction:
   │   │
   │   ├─> Tap "Start Drawing" button
   │   │   └─> setIsDrawing(true)
   │   │
   │   ├─> Tap on map (while drawing)
   │   │   │
   │   │   ├─> handleMapPress()
   │   │   │   │
   │   │   │   ├─> Check: markers.length < 4
   │   │   │   │   │
   │   │   │   │   ├─> YES: Add marker at tapped location
   │   │   │   │   │   └─> setMarkers([...markers, {lat, lon, id}])
   │   │   │   │   │
   │   │   │   │   └─> NO: Show alert "Maximum 4 points"
   │   │   │   │
   │   │   │   └─> Visual feedback: Pin marker + polygon preview
   │   │   │
   │   │   └─> Repeat until 4 points placed
   │   │
   │   ├─> Tap "Undo" button
   │   │   └─> Remove last marker
   │   │
   │   ├─> Tap "Clear All" button
   │   │   └─> Reset all markers
   │   │
   │   └─> Tap "Finish" button
   │       │
   │       ├─> Validation: markers.length === 4
   │       │   │
   │       │   ├─> If valid: setShowNameModal(true)
   │       │   │
   │       │   └─> If invalid: Alert "Need exactly 4 points"
   │       │
   │       └─> Modal: Enter field name
   │           │
   │           └─> Tap "Save Field"
   │               │
   │               ├─> Validation: fieldName.trim() !== ''
   │               │
   │               ├─> Extract geometry:
   │               │   geometry = [
   │               │     [markers[0].latitude, markers[0].longitude],
   │               │     [markers[1].latitude, markers[1].longitude],
   │               │     [markers[2].latitude, markers[2].longitude],
   │               │     [markers[3].latitude, markers[3].longitude]
   │               │   ]
   │               │
   │               └─> API Call: POST /api/v1/fields
   │                   │
   │                   └─> Request Body:
   │                       {
   │                         farmer_ID: auth.currentUser.uid,
   │                         field_name: "North Field",
   │                         geometry: [[lat1,lon1], [lat2,lon2], [lat3,lon3], [lat4,lon4]]
   │                       }

┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: BACKEND FIELD SAVING (server.js)                              │
└─────────────────────────────────────────────────────────────────────────┘

3. Backend Processes Field Creation
   │
   └─> POST /api/v1/fields endpoint
       │
       ├─> Validation:
       │   │
       │   ├─> Check: farmer_ID exists
       │   ├─> Check: field_name exists
       │   ├─> Check: geometry is array with length === 4
       │   │
       │   └─> If validation fails: Return 400 Bad Request
       │
       ├─> Transform geometry to schema:
       │   │
       │   fieldData = {
       │     lat1: geometry[0][0], lon1: geometry[0][1],
       │     lat2: geometry[1][0], lon2: geometry[1][1],
       │     lat3: geometry[2][0], lon3: geometry[2][1],
       │     lat4: geometry[3][0], lon4: geometry[3][1],
       │     createdAt: serverTimestamp()
       │   }
       │
       ├─> Save to Firestore:
       │   │
       │   Collection: users/{farmer_ID}/fields/{field_name}
       │   Document: fieldData (lat1-lon4 schema)
       │
       └─> Return 201 Created:
           {
             field: { id, field_name, lat1-lon4, createdAt },
             ok: true
           }

┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: CROP ADVISORY MAIN SCREEN (CropAdvisory1.jsx)                 │
└─────────────────────────────────────────────────────────────────────────┘

4. CropAdvisory1 Screen (After Field Setup)
   │
   ├─> On Mount:
   │   │
   │   ├─> useEffect(): Auto-select first field
   │   │   └─> setSelectedField(fields[0])
   │   │
   │   └─> useEffect(): Check job status for selected field
   │       │
   │       └─> checkFieldJobStatus()
   │           │
   │           ├─> Check AsyncStorage for cached job_id
   │           │   └─> Key: `job_${field_ID}`
   │           │
   │           ├─> API Call: GET /api/v1/jobs?field_ID={id}&farmer_ID={uid}
   │           │   │
   │           │   └─> Backend Query:
   │           │       │
   │           │       └─> Firestore: users/{uid}/jobs/*
   │           │           .where('field_ID', '==', field_ID)
   │           │           .orderBy('requested_at', 'desc')
   │           │
   │           └─> Update state:
   │               ├─> setCurrentJobId(latestJob.job_ID)
   │               ├─> setJobStatus(latestJob.status)
   │               └─> Cache job_id in AsyncStorage
   │
   ├─> UI Components:
   │   │
   │   ├─> Field Selector Dropdown
   │   │   │
   │   │   └─> Shows: Selected field name
   │   │       │
   │   │       └─> On tap: Open modal with field list
   │   │           │
   │   │           └─> On field selection:
   │   │               ├─> setSelectedField(field)
   │   │               └─> checkFieldJobStatus() // Re-check for new field
   │   │
   │   ├─> Field Info Card
   │   │   │
   │   │   ├─> Display: Field name, area (hectares), coordinates
   │   │   │   │
   │   │   │   └─> Area calculation: calculateArea() function
   │   │   │       └─> Uses spherical excess formula with 4 lat/lon points
   │   │   │
   │   │   ├─> "View on Map" button
   │   │   │   └─> Opens modal with MapView showing field polygon
   │   │   │
   │   │   └─> "Analyze My Field" button OR "Processing..." status
   │   │       │
   │   │       ├─> IF jobStatus === null:
   │   │       │   └─> Show "Analyze My Field" button
   │   │       │
   │   │       └─> IF jobStatus === 'PENDING' or 'PROCESSING':
   │   │           └─> Show: "Processing..." with spinner
   │   │               └─> Display: "Estimated Time: Up to 24 hours"
   │   │
   │   └─> Summary Cards & Recommendations (Static UI for now)
   │
   └─> User Action: Tap "Analyze My Field"
       │
       └─> handleAnalyzeField()
           │
           ├─> Validation:
           │   ├─> Check: selectedField exists
           │   └─> Check: user is authenticated
           │
           ├─> Set loading: setIsAnalyzing(true)
           │
           └─> API Call: POST /api/v1/jobs
               │
               └─> Request Body:
                   {
                     field_ID: selectedField.id,
                     farmer_ID: auth.currentUser.uid,
                     job_type: 'CROP_HEALTH_ANALYSIS'
                   }

┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: JOB CREATION (Backend - server.js)                            │
└─────────────────────────────────────────────────────────────────────────┘

5. Backend Creates Job
   │
   └─> POST /api/v1/jobs endpoint
       │
       ├─> Validation:
       │   ├─> Check: field_ID exists
       │   └─> Check: farmer_ID exists
       │
       ├─> Generate unique job_ID:
       │   └─> `job-${Date.now()}-${randomString}`
       │
       ├─> Prepare job data:
       │   │
       │   jobData = {
       │     job_ID,
       │     field_ID,
       │     farmer_ID,
       │     job_type: 'CROP_HEALTH_ANALYSIS',
       │     status: 'PENDING',
       │     requested_at: serverTimestamp(),
       │     updated_at: serverTimestamp()
       │   }
       │
       ├─> Save to Firestore (DUAL STORAGE):
       │   │
       │   ├─> Main collection: jobs/{job_ID}
       │   │   └─> For global job tracking
       │   │
       │   └─> User subcollection: users/{farmer_ID}/jobs/{job_ID}
       │       └─> For faster user-specific queries
       │
       └─> Return 202 Accepted (Async Processing):
           {
             status: 202,
             message: 'Analysis started! We will notify you when it is ready.',
             job_id: job_ID
           }

┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 6: FRONTEND HANDLES JOB CREATION RESPONSE                        │
└─────────────────────────────────────────────────────────────────────────┘

6. Frontend Receives 202 Response
   │
   └─> In CropAdvisory1.jsx (handleAnalyzeField)
       │
       ├─> Extract: job_id from response
       │
       ├─> Update UI state:
       │   ├─> setCurrentJobId(job_id)
       │   ├─> setJobStatus('PENDING')
       │   └─> setIsAnalyzing(false)
       │
       ├─> Cache locally:
       │   └─> AsyncStorage.setItem(`job_${field_ID}`, job_id)
       │
       ├─> Show success alert:
       │   └─> "We've started processing your request for {field_name}.
       │        We'll send a push notification when your report is ready."
       │
       └─> UI Updates:
           └─> "Analyze My Field" button → "Processing..." status indicator

┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 7: WORKER PROCESSES JOB (Background - worker.js)                 │
└─────────────────────────────────────────────────────────────────────────┘

7. Worker Loop Detects PENDING Job
   │
   └─> Worker running: npm run worker (separate process)
       │
       └─> workerLoop() continuously polls:
           │
           ├─> Query Firestore: jobs collection
           │   │
           │   └─> .where('status', '==', 'PENDING')
           │       .limit(MAX_CONCURRENT_JOBS)
           │
           └─> For each PENDING job:
               │
               └─> processJob(job)

8. Job Processing Pipeline
   │
   └─> processJob(job) function
       │
       ├─> STEP 1: Update Status to PROCESSING
       │   │
       │   └─> Update Firestore:
       │       ├─> jobs/{job_ID}.status = 'PROCESSING'
       │       └─> users/{farmer_ID}/jobs/{job_ID}.status = 'PROCESSING'
       │
       ├─> STEP 2: Fetch Field Data
       │   │
       │   └─> Firestore Query:
       │       └─> users/{farmer_ID}/fields/{field_ID}
       │           │
       │           └─> Extract: lat1-lon4 coordinates
       │               │
       │               └─> Build geometry array:
       │                   [
       │                     [lat1, lon1],
       │                     [lat2, lon2],
       │                     [lat3, lon3],
       │                     [lat4, lon4]
       │                   ]
       │
       ├─> STEP 3: Calculate Field Center
       │   │
       │   └─> centerLat = (lat1 + lat2 + lat3 + lat4) / 4
       │       centerLon = (lon1 + lon2 + lon3 + lon4) / 4
       │       └─> Used for weather API calls
       │
       ├─> STEP 4: Parallel API Calls (Promise.all)
       │   │
       │   ├─> fetchSatelliteData(geometry)
       │   │   │
       │   │   ├─> Provider: Sentinel Hub OR Planet Labs
       │   │   │
       │   │   ├─> API Call (based on SATELLITE_API_PROVIDER):
       │   │   │   │
       │   │   │   ├─> Sentinel Hub:
       │   │   │   │   │
       │   │   │   │   ├─> POST /api/v1/process
       │   │   │   │   │   │
       │   │   │   │   │   ├─> Body: {
       │   │   │   │   │   │     input: {
       │   │   │   │   │   │       bounds: { bbox: [minLon, minLat, maxLon, maxLat] },
       │   │   │   │   │   │       data: [{ type: 'sentinel-2-l2a', ... }]
       │   │   │   │   │   │     },
       │   │   │   │   │   │     evalscript: 'NDVI calculation script'
       │   │   │   │   │   │   }
       │   │   │   │   │   │
       │   │   │   │   │   └─> Response: NDVI map image + processed bands
       │   │   │   │   │
       │   │   │   │   └─> Return: {
       │   │   │   │       ndvi_map_url,
       │   │   │   │       avg_ndvi,
       │   │   │   │       health_score,
       │   │   │   │       raw_data: { nir_band, red_band }
       │   │   │   │     }
       │   │   │   │
       │   │   │   └─> Planet Labs:
       │   │   │       │
       │   │   │       ├─> POST /data/v1/searches/quick
       │   │   │       │   └─> Search for available imagery
       │   │   │       │
       │   │   │       ├─> POST /analytics/v1/ndvi
       │   │   │       │   └─> Request NDVI analysis
       │   │   │       │
       │   │   │       └─> Return: Similar structure
       │   │   │
       │   │   └─> Fallback: If API fails → Use mock data
       │   │
       │   └─> fetchWeatherData(centerLat, centerLon)
       │       │
       │       ├─> Provider: OpenWeatherMap OR WeatherAPI.com
       │       │
       │       ├─> API Call (based on WEATHER_API_PROVIDER):
       │       │   │
       │       │   ├─> OpenWeatherMap:
       │       │   │   │
       │       │   │   ├─> GET /weather?lat={lat}&lon={lon}
       │       │   │   │   └─> Current weather
       │       │   │   │
       │       │   │   └─> GET /forecast?lat={lat}&lon={lon}
       │       │   │       └─> 5-day forecast (3-hour intervals)
       │       │   │
       │       │   └─> WeatherAPI.com:
       │       │       │
       │       │       └─> GET /forecast.json?q={lat},{lon}&days=5
       │       │           └─> Current + 5-day forecast
       │       │
       │       └─> Return: {
       │           forecast_5day: [
       │             { date, temp, rainfall, humidity, description }
       │           ],
       │           current: { temp, humidity, rainfall_today, ... }
       │         }
       │
       ├─> STEP 5: Data Processing
       │   │
       │   ├─> Extract NDVI value:
       │   │   │
       │   │   ├─> Use satelliteData.avg_ndvi if available
       │   │   │
       │   │   └─> OR calculate from raw bands:
       │   │       └─> calculateNDVI(nirValue, redValue)
       │   │           └─> Formula: (NIR - Red) / (NIR + Red)
       │   │
       │   ├─> Fetch Historical NDVI:
       │   │   │
       │   │   └─> getHistoricalNDVI(farmer_ID, field_ID)
       │   │       │
       │   │       ├─> Query: users/{farmer_ID}/reports/*
       │   │       │   .where('field_ID', '==', field_ID)
       │   │       │   .orderBy('generated_at', 'desc')
       │   │       │   .limit(10)
       │   │       │
       │   │       ├─> Extract: average_ndvi from each report
       │   │       │
       │   │       └─> Calculate: Average of last 10 reports
       │   │           └─> Fallback: 0.68 if no history
       │   │
       │   └─> Detect Anomalies:
       │       │
       │       └─> detectAnomalies(currentNDVI, historicalAverage)
       │           │
       │           ├─> Calculate difference:
       │           │   └─> percentDifference = ((current - historical) / historical) * 100
       │           │
       │           ├─> Analyze thresholds:
       │           │   │
       │           │   ├─> IF currentNDVI < 0.3:
       │           │   │   └─> overall_health = 'critical'
       │           │   │
       │           │   ├─> IF currentNDVI < 0.5:
       │           │   │   └─> overall_health = 'poor'
       │           │   │
       │           │   ├─> IF percentDifference < -15%:
       │           │   │   └─> overall_health = 'needs_attention'
       │           │   │
       │           │   └─> IF percentDifference < -10%:
       │           │       └─> overall_health = 'monitor'
       │           │
       │           └─> Return: {
       │               stress_areas: [...],
       │               overall_health: 'good' | 'monitor' | 'needs_attention' | 'poor' | 'critical',
       │               ndvi_comparison: { current, historical_average, difference, percent_change }
       │             }
       │
       ├─> STEP 6: Generate AI Recommendations
       │   │
       │   └─> generateRecommendation(satelliteData, weatherData, anomalies, cropType)
       │       │
       │       ├─> Priority 1: Critical Health Issues
       │       │   └─> IF overall_health === 'critical' OR health_score < 40
       │       │       └─> Recommendation: "Immediate attention required"
       │       │
       │       ├─> Priority 2: Water Stress
       │       │   └─> IF stress_areas found
       │       │       └─> Recommendation: "Irrigation needed" (with urgency hours)
       │       │
       │       ├─> Priority 3: Weather-Based
       │       │   │
       │       │   ├─> IF low rainfall forecast + existing stress
       │       │   │   └─> Recommendation: "Extended dry period - proactive irrigation"
       │       │   │
       │       │   └─> IF high temperatures + low NDVI
       │       │       └─> Recommendation: "Heat management - increase irrigation"
       │       │
       │       ├─> Priority 4: Nutrient Management
       │       │   └─> IF health_score < 60
       │       │       └─> Recommendation: "Nutrient management - soil testing & fertilization"
       │       │
       │       └─> Priority 5: Monitoring
       │           └─> IF health is acceptable
       │               └─> Recommendation: "Continue monitoring - schedule next analysis"
       │
       ├─> STEP 7: Generate Report
       │   │
       │   └─> Create report object:
       │       │
       │       report = {
       │         field_ID,
       │         field_name,
       │         generated_at: serverTimestamp(),
       │         ndvi_analysis: {
       │           average_ndvi,
       │           health_score,
       │           map_url
       │         },
       │         weather_forecast: forecast_5day,
       │         anomalies: {
       │           stress_areas,
       │           overall_health,
       │           ndvi_comparison
       │         },
       │         recommendations: {
       │           primary_recommendation,
       │           all_recommendations
       │         },
       │         summary: {
       │           overall_health,
       │           primary_concern,
       │           action_required
       │         }
       │       }
       │
       ├─> STEP 8: Save Report to Firestore
       │   │
       │   ├─> Main collection: reports/{job_ID}
       │   │   └─> Store full report document
       │   │
       │   └─> User subcollection: users/{farmer_ID}/reports/{job_ID}
       │       └─> Store report (for easier user queries)
       │
       └─> STEP 9: Update Job Status to COMPLETED
           │
           └─> Update Firestore:
               ├─> jobs/{job_ID}
               │   ├─> status = 'COMPLETED'
               │   ├─> report_id = job_ID
               │   └─> completed_at = serverTimestamp()
               │
               └─> users/{farmer_ID}/jobs/{job_ID}
                   └─> Same updates

┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 8: FRONTEND STATUS CHECKING (Periodic/Polling)                   │
└─────────────────────────────────────────────────────────────────────────┘

9. Frontend Monitors Job Status
   │
   └─> When user returns to screen or refreshes:
       │
       └─> checkFieldJobStatus() (called when selectedField changes)
           │
           ├─> API Call: GET /api/v1/jobs?field_ID={id}&farmer_ID={uid}
           │   │
           │   └─> Backend returns latest job for that field
           │       │
           │       └─> Response: {
           │           jobs: [{
           │             job_ID,
           │             status: 'COMPLETED' | 'PROCESSING' | 'FAILED',
           │             report_id,
           │             completed_at,
           │             ...
           │           }],
           │           ok: true
           │         }
           │
           ├─> IF status === 'COMPLETED':
           │   │
           │   ├─> Update UI: Show "Completed" indicator
           │   │
           │   └─> Fetch report:
           │       └─> Query: users/{uid}/reports/{job_ID}
           │           │
           │           └─> Display:
           │               ├─> NDVI map
           │               ├─> Health score
           │               ├─> Weather forecast
           │               ├─> Anomalies detected
               │               └─> AI Recommendations
           │
           └─> IF status === 'FAILED':
               └─> Show error message + retry option

┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 9: DISPLAYING RESULTS (Future Implementation)                    │
└─────────────────────────────────────────────────────────────────────────┘

10. Report Display (To be implemented)
    │
    └─> When job status === 'COMPLETED':
        │
        ├─> Fetch report from Firestore:
        │   └─> users/{uid}/reports/{job_ID}
        │
        ├─> Render Report Components:
        │   │
        │   ├─> NDVI Map View
        │   │   └─> Display satellite image with health overlay
        │   │
        │   ├─> Health Score Card
        │   │   └─> Show: overall_health, health_score, comparison
        │   │
        │   ├─> Weather Forecast
        │   │   └─> 5-day forecast with rainfall, temperature
        │   │
        │   ├─> Anomalies Section
        │   │   └─> List stress areas with severity
        │   │
        │   └─> Recommendations Section
        │       │
        │       ├─> Primary Recommendation (highlighted)
        │       │   └─> Shows: type, priority, message, action, urgency
        │       │
        │       └─> All Recommendations (expandable list)
        │           └─> Sorted by priority (critical → low)

┌─────────────────────────────────────────────────────────────────────────┐
│ ERROR HANDLING                                                          │
└─────────────────────────────────────────────────────────────────────────┘

11. Error Scenarios
    │
    ├─> Field Setup Errors:
    │   │
    │   ├─> Invalid geometry (< 4 points)
    │   │   └─> Alert user + prevent save
    │   │
    │   ├─> API failure (network/server error)
    │   │   └─> Show error alert + allow retry
    │   │
    │   └─> Authentication error
    │       └─> Redirect to login
    │
    ├─> Job Creation Errors:
    │   │
    │   ├─> No field selected
    │   │   └─> Alert: "Please select a field first"
    │   │
    │   ├─> User not authenticated
    │   │   └─> Alert: "You must be logged in"
    │   │
    │   └─> API failure
    │       └─> Alert: "Failed to start analysis. Please try again."
    │
    └─> Worker Processing Errors:
        │
        ├─> Field not found
        │   └─> Update job status to FAILED + log error
        │
        ├─> Satellite API failure
        │   └─> Fallback to mock data + log warning
        │
        ├─> Weather API failure
        │   └─> Fallback to mock data + log warning
        │
        └─> Firestore save failure
            └─> Update job status to FAILED + log error

┌─────────────────────────────────────────────────────────────────────────┐
│ DATA FLOW SUMMARY                                                       │
└─────────────────────────────────────────────────────────────────────────┘

FRONTEND → BACKEND → FIRESTORE → WORKER → EXTERNAL APIs → FIRESTORE → FRONTEND

1. Field Setup:
   App → POST /api/v1/fields → Firestore: users/{uid}/fields/{name}

2. Job Creation:
   App → POST /api/v1/jobs → Firestore: jobs/{job_ID} + users/{uid}/jobs/{job_ID}

3. Job Processing:
   Worker → Firestore: Read field → External APIs (Satellite + Weather) → 
   Process data → Firestore: Save report + Update job status

4. Status Checking:
   App → GET /api/v1/jobs → Firestore: users/{uid}/jobs/* → Display status

5. Report Fetching:
   App → Firestore: users/{uid}/reports/{job_ID} → Display report

┌─────────────────────────────────────────────────────────────────────────┐
│ KEY TECHNOLOGIES & CONCEPTS                                             │
└─────────────────────────────────────────────────────────────────────────┘

- React Native (Expo): Mobile app framework
- React Navigation: Screen routing
- Firebase Auth: User authentication
- Firestore: NoSQL database for field/job/report storage
- Express.js: Backend API server
- Node.js Worker: Background job processing
- Axios: HTTP client for API calls
- AsyncStorage: Local caching for job IDs
- react-native-maps: Map component for field drawing
- expo-location: GPS location access
- Sentinel Hub / Planet Labs: Satellite imagery APIs
- OpenWeatherMap / WeatherAPI: Weather forecast APIs
- NDVI (Normalized Difference Vegetation Index): Crop health metric
- Asynchronous Job Queue: Firestore-based job processing
- Concurrency Control: MAX_CONCURRENT_JOBS limit

┌─────────────────────────────────────────────────────────────────────────┐
│ CONFIGURATION & ENVIRONMENT                                             │
└─────────────────────────────────────────────────────────────────────────┘

Environment Variables (.env):
- SATELLITE_API_PROVIDER: 'sentinel_hub' | 'planet_labs'
- SATELLITE_API_KEY: API key for satellite provider
- WEATHER_API_PROVIDER: 'openweathermap' | 'weatherapi'
- WEATHER_API_KEY: API key for weather provider
- WORKER_POLL_INTERVAL_MS: How often worker checks for jobs (default: 5000ms)
- MAX_CONCURRENT_JOBS: Max jobs processed simultaneously (default: 3)
- API_TIMEOUT_MS: Timeout for external API calls (default: 30000ms)

Firestore Collections Structure:
```
users/
  {farmer_ID}/
    fields/
      {field_name}/ → { lat1, lon1, lat2, lon2, lat3, lon3, lat4, lon4, createdAt }
    jobs/
      {job_ID}/ → { job_ID, field_ID, farmer_ID, status, requested_at, ... }
    reports/
      {job_ID}/ → { field_ID, ndvi_analysis, weather_forecast, anomalies, recommendations, ... }

jobs/
  {job_ID}/ → { job_ID, field_ID, farmer_ID, status, requested_at, ... }

reports/
  {job_ID}/ → { Full report document }
```

