import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import axios from 'axios';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';

// Get current directory in ES modules (for dotenv path)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from project root (one level up from src/)
dotenv.config({ path: join(__dirname, '..', '.env') });

// Configure Cloudinary (used as storage fallback)
const CLOUDINARY_URL = process.env.CLOUDINARY_URL;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

let cloudinaryConfigured = false;

try {
  let cloudName, apiKey, apiSecret;
  
  // Parse CLOUDINARY_URL if provided (format: cloudinary://api_key:api_secret@cloud_name)
  if (CLOUDINARY_URL) {
    try {
      const url = new URL(CLOUDINARY_URL);
      apiKey = url.username;
      apiSecret = url.password;
      cloudName = url.hostname;
      console.log(`📋 Parsed CLOUDINARY_URL: cloud=${cloudName}, api_key=${apiKey?.substring(0, 8)}...`);
    } catch (parseError) {
      console.warn('⚠️ Failed to parse CLOUDINARY_URL, using individual env vars:', parseError.message);
    }
  }
  
  // Use individual env vars if URL parsing failed or wasn't provided
  if (!cloudName || !apiKey || !apiSecret) {
    cloudName = CLOUDINARY_CLOUD_NAME;
    apiKey = CLOUDINARY_API_KEY;
    apiSecret = CLOUDINARY_API_SECRET;
  }
  
  // Configure Cloudinary if we have all required credentials
  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    cloudinaryConfigured = true;
    console.log(`✅ Cloudinary fallback configured (cloud: ${cloudName})`);
  } else {
    console.log('ℹ️ Cloudinary fallback not configured (set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)');
  }
} catch (cloudinaryError) {
  console.error('⚠️ Cloudinary configuration error:', cloudinaryError.message);
}

// Calculate area in hectares from 4 lat/lon points
function calculateArea(lat1, lon1, lat2, lon2, lat3, lon3, lat4, lon4) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  
  const points = [
    { lat: toRad(lat1), lon: toRad(lon1) },
    { lat: toRad(lat2), lon: toRad(lon2) },
    { lat: toRad(lat3), lon: toRad(lon3) },
    { lat: toRad(lat4), lon: toRad(lon4) },
  ];
  
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += (points[i].lon - points[j].lon) * (2 + Math.sin(points[i].lat) + Math.sin(points[j].lat));
  }
  area = Math.abs(area * R * R) / 2;
  return (area / 10000).toFixed(2); // Convert to hectares
}

// Production API Configuration
const SATELLITE_API_PROVIDER = process.env.SATELLITE_API_PROVIDER || 'sentinel_hub';
const SATELLITE_API_KEY = process.env.SATELLITE_API_KEY;
const SATELLITE_API_URL = process.env.SATELLITE_API_URL || 'https://services.sentinel-hub.com/api/v1';

// Sentinel Hub OAuth Credentials
const SENTINEL_HUB_CLIENT_ID = process.env.SENTINEL_HUB_CLIENT_ID;
const SENTINEL_HUB_CLIENT_SECRET = process.env.SENTINEL_HUB_CLIENT_SECRET;

const WEATHER_API_PROVIDER = process.env.WEATHER_API_PROVIDER || 'openweathermap';
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_URL = process.env.WEATHER_API_URL || 'https://api.openweathermap.org/data/2.5';

const WORKER_POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);
const API_TIMEOUT_MS = parseInt(process.env.API_TIMEOUT_MS || '30000', 10);

// Token cache for Sentinel Hub OAuth
let sentinelHubTokenCache = {
  token: null,
  expiresAt: 0,
};

// Validate required API keys - PRODUCTION MODE: No API keys = Errors
if (!SATELLITE_API_KEY) {
  console.error('❌ ERROR: SATELLITE_API_KEY not set. Cannot fetch satellite data.');
  console.error('   Set SATELLITE_API_KEY in .env file');
}

if (!WEATHER_API_KEY) {
  console.error('❌ ERROR: WEATHER_API_KEY not set. Cannot fetch weather data.');
  console.error('   Set WEATHER_API_KEY in .env file');
}


// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccountPath = join(__dirname, '..', 'serviceAccountKey.json');
    const fileContent = readFileSync(serviceAccountPath, 'utf8');
    const serviceAccount = JSON.parse(fileContent);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'hal-app-41b87',
    });
    console.log('✅ Worker: Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Worker: Error initializing Firebase Admin:', error.message);
    process.exit(1);
  }
}

const db = admin.firestore();

// Get Firebase Storage bucket
// Firebase Storage uses: {projectId}.firebasestorage.app (new format)
// Legacy format: {projectId}.appspot.com
const projectId = 'hal-app-41b87';
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
const bucket = admin.storage().bucket(bucketName);

// Verify bucket exists
async function ensureBucketExists() {
  try {
    const [exists] = await bucket.exists();
    if (exists) {
      console.log(`✅ Firebase Storage bucket verified: ${bucketName}`);
    } else {
      console.log(`⚠️  Bucket ${bucketName} does not exist. It will be created automatically on first upload, or create it manually in Firebase Console.`);
      console.log(`   Firebase Console: https://console.firebase.google.com/project/${projectId}/storage`);
    }
  } catch (error) {
    console.error(`⚠️  Could not verify bucket (will try on upload): ${error.message}`);
    // Continue anyway - bucket might be created automatically on first upload
  }
}

// Call this on worker startup (non-blocking)
ensureBucketExists().catch(err => {
  console.error('⚠️  Could not verify bucket:', err.message);
});

// Storage Helper Functions (Firebase primary, Cloudinary fallback)
async function uploadImageToFirebase(imageBuffer, filePath, contentType = 'image/png') {
  console.log(`📤 Uploading image to Firebase Storage: ${filePath}`);
  console.log(`   Bucket: ${bucket.name}`);
  
  // Ensure bucket exists before uploading
  const [exists] = await bucket.exists();
  if (!exists) {
    console.log(`   ⚠️  Bucket ${bucket.name} does not exist, attempting to create...`);
    try {
      await bucket.create();
      console.log(`   ✅ Bucket created successfully`);
    } catch (createError) {
      console.error(`   ❌ Failed to create bucket: ${createError.message}`);
      // Try uploading anyway - Firebase might auto-create on first upload
      console.log(`   ⚠️  Will attempt upload anyway (Firebase may auto-create bucket)`);
    }
  }
  
  const file = bucket.file(filePath);
  const stream = file.createWriteStream({
    metadata: {
      contentType,
      metadata: {
        uploadedAt: new Date().toISOString(),
      },
    },
    public: true, // Make file publicly accessible
  });
  
  return new Promise((resolve, reject) => {
    stream.on('error', (error) => {
      console.error('❌ Error uploading to Firebase Storage:', error.message);
      if (error.code === 404) {
        reject(new Error(
          `Firebase Storage bucket "${bucket.name}" not found. ` +
          `Please create it in Firebase Console: https://console.firebase.google.com/project/${projectId}/storage`
        ));
      } else {
        reject(error);
      }
    });
    
    stream.on('finish', async () => {
      try {
        // Make file publicly accessible
        await file.makePublic();
        
        // Get public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
        console.log(`✅ Image uploaded to Firebase Storage: ${publicUrl}`);
        resolve(publicUrl);
      } catch (makePublicError) {
        console.error('⚠️  Error making file public:', makePublicError.message);
        // Still return the URL even if making public fails
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
        resolve(publicUrl);
      }
    });
    
    stream.end(imageBuffer);
  });
}

function sanitizeCloudinaryPath(filePath) {
  const withoutExtension = filePath.replace(/\.[^/.]+$/, '');
  return withoutExtension
    .split('/')
    .map(segment => segment.replace(/[^a-zA-Z0-9_-]/g, '_'))
    .filter(Boolean);
}

async function uploadImageToCloudinary(imageBuffer, filePath, contentType = 'image/png') {
  if (!cloudinaryConfigured) {
    throw new Error('Cloudinary fallback is not configured');
  }
  
  const pathSegments = sanitizeCloudinaryPath(filePath);
  const publicId = pathSegments.pop() || 'hal_asset';
  const folder = pathSegments.length > 0 ? pathSegments.join('/') : undefined;
  
  console.log(`☁️  Uploading image to Cloudinary: ${folder ? `${folder}/` : ''}${publicId}`);
  
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        overwrite: true,
        use_filename: false,
        unique_filename: false,
        ...(folder && { folder }),
        public_id: publicId,
      },
      (error, result) => {
        if (error) {
          console.error('❌ Cloudinary upload failed:', error.message);
          reject(error);
          return;
        }
        
        const secureUrl = result?.secure_url || result?.url;
        if (!secureUrl) {
          reject(new Error('Cloudinary upload succeeded but no URL was returned'));
          return;
        }
        
        console.log(`✅ Image uploaded to Cloudinary: ${secureUrl}`);
        resolve(secureUrl);
      }
    );
    
    uploadStream.end(imageBuffer);
  });
}

async function uploadImageToStorage(imageBuffer, filePath, contentType = 'image/png') {
  try {
    return await uploadImageToFirebase(imageBuffer, filePath, contentType);
  } catch (error) {
    console.error('❌ Primary Firebase upload failed:', error.message);
    
    const isBillingIssue = typeof error.message === 'string' && error.message.toLowerCase().includes('billing account');
    const shouldFallback = cloudinaryConfigured;
    
    if (!shouldFallback) {
      console.error('⚠️ Cloudinary fallback not available. Re-throwing error.');
      throw error;
    }
    
    if (isBillingIssue) {
      console.warn('⚠️ Firebase billing issue detected. Falling back to Cloudinary.');
    } else {
      console.warn('⚠️ Firebase upload failed. Attempting Cloudinary fallback...');
    }
    
    try {
      return await uploadImageToCloudinary(imageBuffer, filePath, contentType);
    } catch (cloudinaryError) {
      console.error('❌ Cloudinary fallback also failed:', cloudinaryError.message);
      // Throw original error to keep context, but append Cloudinary failure
      const combinedError = new Error(
        `Firebase upload failed (${error.message}). Cloudinary fallback error: ${cloudinaryError.message}`
      );
      combinedError.originalError = error;
      combinedError.cloudinaryError = cloudinaryError;
      throw combinedError;
    }
  }
}

async function downloadAndStoreImage(imageUrl, storagePath, farmer_ID, job_ID, imageType = 'ndvi_map') {
  try {
    console.log(`📥 Downloading image from: ${imageUrl}`);
    
    // Download image as buffer
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: API_TIMEOUT_MS,
      headers: {
        // Add headers if needed for authentication
        ...(SATELLITE_API_KEY && { Authorization: `Bearer ${SATELLITE_API_KEY}` }),
      },
    });
    
    const imageBuffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || 'image/png';
    
    // Generate storage path: reports/{farmer_ID}/{job_ID}/{imageType}.png
    const fullStoragePath = storagePath || `reports/${farmer_ID}/${job_ID}/${imageType}.png`;
    
    // Upload to storage (Firebase primary, Cloudinary fallback)
    const firebaseUrl = await uploadImageToStorage(imageBuffer, fullStoragePath, contentType);
    
    return firebaseUrl;
  } catch (error) {
    console.error(`❌ Error downloading/storing image from ${imageUrl}:`, error.message);
    // Return original URL as fallback
    return imageUrl;
  }
}

// Sentinel Hub OAuth Token Exchange
async function getSentinelHubAccessToken() {
  // Check if we have a valid cached token
  if (sentinelHubTokenCache.token && Date.now() < sentinelHubTokenCache.expiresAt) {
    return sentinelHubTokenCache.token;
  }
  
  // Need to get client ID and secret
  if (!SENTINEL_HUB_CLIENT_ID || !SENTINEL_HUB_CLIENT_SECRET) {
    throw new Error(
      'Sentinel Hub OAuth credentials not configured. ' +
      'Please set SENTINEL_HUB_CLIENT_ID and SENTINEL_HUB_CLIENT_SECRET in .env file.'
    );
  }
  
  console.log('🔑 Exchanging Sentinel Hub OAuth credentials for access token...');
  
  // Try different Sentinel Hub OAuth endpoints
  // Based on apps.sentinel-hub.com dashboard (Legacy Sentinel Hub)
  // The correct endpoint for Legacy Sentinel Hub is services.sentinel-hub.com/oauth/token
  const oauthEndpoints = [
    {
      name: 'Sentinel Hub Legacy (services.sentinel-hub.com)',
      url: 'https://services.sentinel-hub.com/oauth/token',
      // Legacy endpoint uses basic auth or form data
    },
    {
      name: 'Sentinel Hub Legacy (oauth.sentinel-hub.com)',
      url: 'https://oauth.sentinel-hub.com/auth/realms/sentinel-hub/protocol/openid-connect/token',
      // Keycloak endpoint
    },
  ];
  
  let lastError = null;
  
  for (const endpoint of oauthEndpoints) {
    try {
      console.log(`   Trying ${endpoint.name}...`);
      console.log(`   URL: ${endpoint.url}`);
      console.log(`   Client ID: ${SENTINEL_HUB_CLIENT_ID.substring(0, 8)}...`);
      
      // Legacy Sentinel Hub (services.sentinel-hub.com/oauth/token) may use Basic Auth
      let tokenResponse;
      if (endpoint.url.includes('services.sentinel-hub.com/oauth/token')) {
        // Try with Basic Auth first (common for Legacy Sentinel Hub)
        try {
          tokenResponse = await axios.post(
            endpoint.url,
            new URLSearchParams({
              grant_type: 'client_credentials',
            }),
            {
              auth: {
                username: SENTINEL_HUB_CLIENT_ID,
                password: SENTINEL_HUB_CLIENT_SECRET,
              },
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              timeout: API_TIMEOUT_MS,
            }
          );
        } catch (basicAuthError) {
          // If Basic Auth fails, try form data
          console.log(`   Basic Auth failed, trying form data...`);
          tokenResponse = await axios.post(
            endpoint.url,
            new URLSearchParams({
              grant_type: 'client_credentials',
              client_id: SENTINEL_HUB_CLIENT_ID,
              client_secret: SENTINEL_HUB_CLIENT_SECRET,
            }),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              timeout: API_TIMEOUT_MS,
            }
          );
        }
      } else {
        // Keycloak endpoints use form data
        tokenResponse = await axios.post(
          endpoint.url,
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: SENTINEL_HUB_CLIENT_ID,
            client_secret: SENTINEL_HUB_CLIENT_SECRET,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: API_TIMEOUT_MS,
          }
        );
      }
      
      // Success!
      console.log(`   ✅ Success with ${endpoint.name}`);
    
      const accessToken = tokenResponse.data.access_token;
      const expiresIn = tokenResponse.data.expires_in || 3600; // Default 1 hour
      
      // Cache the token (expire 5 minutes before actual expiry for safety)
      sentinelHubTokenCache = {
        token: accessToken,
        expiresAt: Date.now() + (expiresIn - 300) * 1000,
      };
      
      console.log('✅ Successfully obtained Sentinel Hub access token');
      return accessToken;
    } catch (error) {
      // Save error but try next endpoint
      lastError = error;
      console.log(`   ❌ ${endpoint.name} failed: ${error.response?.status} - ${error.response?.data?.error_description || error.message}`);
      continue; // Try next endpoint
    }
  }
  
  // If we get here, all endpoints failed
  console.error('❌ All Sentinel Hub OAuth endpoints failed');
  if (lastError) {
    console.error('   Last error details:', lastError.response?.status, lastError.response?.statusText);
    console.error('   Error response:', lastError.response?.data || lastError.message);
  }
  
  throw new Error(
    `Failed to authenticate with Sentinel Hub using any endpoint. ` +
    `Please verify:\n` +
    `1. SENTINEL_HUB_CLIENT_ID and SENTINEL_HUB_CLIENT_SECRET are correct\n` +
    `2. The credentials match the Sentinel Hub service you're using (Legacy vs CDSE)\n` +
    `3. Check: https://docs.sentinel-hub.com/api/latest/api/overview/authentication/`
  );
}

// Production Satellite API Functions - PRODUCTION ONLY, NO MOCK DATA
async function fetchSatelliteData(fieldGeometry, farmer_ID, job_ID) {
  console.log('🛰️  Fetching satellite data for field...');
  
  if (SATELLITE_API_PROVIDER === 'sentinel_hub') {
    // For Sentinel Hub, we'll get the token from OAuth credentials
    if (!SATELLITE_API_KEY || SATELLITE_API_KEY === 'YOUR_SENTINEL_HUB_OAUTH_TOKEN') {
      // Try to get token from OAuth credentials if direct token not provided
      if (SENTINEL_HUB_CLIENT_ID && SENTINEL_HUB_CLIENT_SECRET) {
        // Will get token in fetchSentinelHubData
      } else {
        throw new Error(
          'Sentinel Hub credentials not configured. ' +
          'Please set either SATELLITE_API_KEY (direct token) or both SENTINEL_HUB_CLIENT_ID and SENTINEL_HUB_CLIENT_SECRET in .env file.'
        );
      }
    }
    return await fetchSentinelHubData(fieldGeometry, farmer_ID, job_ID);
  } else if (SATELLITE_API_PROVIDER === 'planet_labs') {
    if (!SATELLITE_API_KEY || SATELLITE_API_KEY === 'YOUR_SENTINEL_HUB_OAUTH_TOKEN') {
      throw new Error('SATELLITE_API_KEY is required for Planet Labs.');
    }
    return await fetchPlanetLabsData(fieldGeometry, farmer_ID, job_ID);
  } else {
    throw new Error(`Unknown satellite provider: ${SATELLITE_API_PROVIDER}. Supported: sentinel_hub, planet_labs`);
  }
}

async function fetchSentinelHubData(fieldGeometry, farmer_ID, job_ID) {
  console.log('🛰️  Fetching Sentinel Hub satellite data...');
  
  // Convert polygon to Sentinel Hub format (GeoJSON)
  // Sentinel Hub uses [lon, lat] format and expects coordinates in WGS84
  const bbox = calculateBoundingBox(fieldGeometry);
  
  // Time range for searching available images
  const timeRange = {
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // Last 30 days
    to: new Date().toISOString(),
  };
  
  // Create closed polygon ring (first point must equal last point)
  // GeoJSON Polygon requires the first and last coordinates to be identical
  const polygonCoordinates = fieldGeometry.map(coord => [coord[1], coord[0]]); // [lon, lat]
  
  // CRITICAL: Close the ring by adding the first point at the end
  // Sentinel Hub requires this for valid GeoJSON Polygon
  // Always ensure the ring is closed
  if (polygonCoordinates.length >= 2) {
    const firstPoint = polygonCoordinates[0];
    const lastPoint = polygonCoordinates[polygonCoordinates.length - 1];
    
    // Only add if last point doesn't already equal first point (within small epsilon)
    const epsilon = 0.0000001;
    const isClosed = Math.abs(firstPoint[0] - lastPoint[0]) < epsilon && 
                     Math.abs(firstPoint[1] - lastPoint[1]) < epsilon;
    
    if (!isClosed) {
      polygonCoordinates.push([firstPoint[0], firstPoint[1]]); // Add first point to close ring
      console.log(`   ✅ Closed polygon ring: added first point at end`);
    } else {
      console.log(`   ✅ Polygon ring already closed`);
    }
  }
  
  console.log(`   Polygon coordinates count: ${polygonCoordinates.length} (should be ${fieldGeometry.length + 1} for closed ring)`);
  
  const polygon = {
    type: 'Polygon',
    coordinates: [polygonCoordinates], // Must be array of rings (outer ring is first)
  };
  
  // According to Sentinel Hub API docs: https://docs.sentinel-hub.com/api/latest/reference/
  // POST /api/v1/process requires: input, output, evalscript
  const requestBody = {
    input: {
      bounds: {
        bbox: bbox, // [minLon, minLat, maxLon, maxLat]
        geometry: polygon, // Optional: full geometry for better accuracy
        properties: {
          crs: 'http://www.opengis.net/def/crs/EPSG/0/4326',
        },
      },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: {
              from: timeRange.from,
              to: timeRange.to,
            },
            maxCloudCoverage: 10, // Stricter cloud filtering (10% max)
          },
        },
      ],
    },
    output: {
      width: 512,
      height: 512,
      responses: [
        {
          identifier: 'default',
          format: {
            type: 'image/png',
          },
        },
      ],
    },
    evalscript: `
      // NDVI Calculation with Color Visualization and Cloud Masking
      // Sentinel-2 L2A bands: B04 = Red, B08 = NIR, SCL = Scene Classification Layer
      // Output RGB image with NDVI color map, clouds shown as light gray/blue
      function setup() {
        return {
          input: [{
            bands: ["B04", "B08", "SCL"], // Include SCL for cloud detection (optional)
            units: "DN" // Ensure we get DN values
          }],
          output: {
            id: "default",
            bands: 3, // RGB output for colorized visualization
            sampleType: "UINT8"  // PNG format requires UINT8
          }
        };
      }
      
      // Check if pixel is cloud using Scene Classification Layer (SCL)
      // SCL values: 0=NoData, 1=Saturated/Defective, 2=Dark Area Pixels, 3=Cloud Shadows
      // 4=Vegetation, 5=Not Vegetated, 6=Water, 7=Unclassified, 8=Cloud Medium Probability
      // 9=Cloud High Probability, 10=Thin Cirrus, 11=Snow/Ice
      function isCloud(scl) {
        if (scl === undefined || scl === null) return false;
        return scl === 8 || scl === 9 || scl === 10; // Cloud or cirrus
      }
      
      function isCloudShadow(scl) {
        if (scl === undefined || scl === null) return false;
        return scl === 3;
      }
      
      function isNoData(scl) {
        if (scl === undefined || scl === null) return false;
        return scl === 0 || scl === 1; // No data or saturated
      }
      
      // NDVI Color Map: Convert NDVI [-1, 1] to RGB colors
      // Red/Brown: low NDVI (bare soil, water) [0.0-0.2]
      // Yellow: low-medium NDVI (sparse vegetation) [0.2-0.4]
      // Light Green: medium NDVI (moderate vegetation) [0.4-0.6]
      // Dark Green: high NDVI (healthy vegetation) [0.6-1.0]
      function ndviToColor(ndvi) {
        if (ndvi < 0.0) {
          // Very low/negative NDVI - Blue (water)
          return [0, 0, 128];
        } else if (ndvi < 0.2) {
          // Low NDVI - Red/Brown (bare soil)
          const t = ndvi / 0.2;
          return [139 + Math.round(116 * t), 69 + Math.round(31 * t), 19 + Math.round(12 * t)];
        } else if (ndvi < 0.4) {
          // Medium-low NDVI - Yellow (sparse vegetation)
          const t = (ndvi - 0.2) / 0.2;
          return [255, 255 - Math.round(100 * t), 0];
        } else if (ndvi < 0.6) {
          // Medium NDVI - Light Green (moderate vegetation)
          const t = (ndvi - 0.4) / 0.2;
          return [144 - Math.round(44 * t), 238 - Math.round(138 * t), 144 - Math.round(44 * t)];
        } else {
          // High NDVI - Dark Green (healthy vegetation)
          const t = Math.min(1, (ndvi - 0.6) / 0.4);
          return [34 + Math.round(34 * t), 139 + Math.round(99 * t), 34 + Math.round(34 * t)];
        }
      }
      
      function evaluatePixel(samples) {
        const red = samples.B04;
        const nir = samples.B08;
        const scl = samples.SCL; // May be undefined if SCL band not available
        
        // Handle cloud pixels - show as light gray/blue (if SCL available)
        if (scl !== undefined && scl !== null && isCloud(scl)) {
          return [200, 220, 240]; // Light blue-gray for clouds
        }
        
        // Handle cloud shadows - show as dark gray (if SCL available)
        if (scl !== undefined && scl !== null && isCloudShadow(scl)) {
          return [100, 100, 100]; // Dark gray for shadows
        }
        
        // Handle no data - show as white (if SCL available)
        if (scl !== undefined && scl !== null && isNoData(scl)) {
          return [255, 255, 255]; // White for no data
        }
        
        // Validate that we have valid spectral data
        if (!red || !nir || red <= 0 || nir <= 0) {
          return [200, 200, 200]; // Light gray for invalid pixels
        }
        
        // Calculate NDVI for valid pixels
        const denominator = nir + red;
        if (denominator <= 0) {
          return [200, 200, 200]; // Light gray for invalid calculation
        }
        
        const ndvi = (nir - red) / denominator;
        const clampedNDVI = Math.max(-1, Math.min(1, ndvi));
        
        // Convert NDVI to RGB color for visualization
        const rgb = ndviToColor(clampedNDVI);
        
        return rgb; // Return [R, G, B] for colored visualization
      }
    `,
  };
  
  console.log(`   Request URL: ${SATELLITE_API_URL}/process`);
  console.log(`   Bbox: [${bbox.join(', ')}]`);
  console.log(`   Time range: ${requestBody.input.data[0].dataFilter.timeRange.from} to ${requestBody.input.data[0].dataFilter.timeRange.to}`);
  
  // Get access token (either from SATELLITE_API_KEY or by exchanging OAuth credentials)
  let accessToken;
  if (SATELLITE_API_KEY && SATELLITE_API_KEY !== 'YOUR_SENTINEL_HUB_OAUTH_TOKEN') {
    // Use direct token if provided
    accessToken = SATELLITE_API_KEY;
  } else if (SENTINEL_HUB_CLIENT_ID && SENTINEL_HUB_CLIENT_SECRET) {
    // Exchange OAuth credentials for access token
    accessToken = await getSentinelHubAccessToken();
  } else {
    throw new Error(
      'Sentinel Hub authentication not configured. ' +
      'Please set either SATELLITE_API_KEY (direct token) or both SENTINEL_HUB_CLIENT_ID and SENTINEL_HUB_CLIENT_SECRET in .env file.'
    );
  }
  
  // Step 1: Query Catalog API to find the most recent available image and get its acquisition date
  let satelliteAcquisitionDate = null;
  try {
    console.log('   🔍 Searching for available Sentinel-2 images...');
    const catalogRequest = {
      bbox: bbox,
      datetime: `${timeRange.from}/${timeRange.to}`,
      collections: ['sentinel-s2-l2a'],
      // Use STAC-style query for cloud cover <= 10
      query: {
        'eo:cloud_cover': { lte: 10 }
      },
      limit: 1,
    };
    
    const catalogResponse = await axios.post(
      `${SATELLITE_API_URL.replace('/api/v1', '')}/api/v1/catalog/1.0.0/search`,
      catalogRequest,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: API_TIMEOUT_MS,
      }
    );
    
    if (catalogResponse.data?.features && catalogResponse.data.features.length > 0) {
      const latestFeature = catalogResponse.data.features[0];
      // Extract datetime from the feature (format: "2023-10-15T10:30:00Z")
      satelliteAcquisitionDate = latestFeature.properties?.datetime || latestFeature.properties?.start_datetime;
      if (satelliteAcquisitionDate) {
        console.log(`   ✅ Found satellite image acquired on: ${satelliteAcquisitionDate}`);
      }
    } else {
      console.log('   ⚠️  No images found in catalog, will use processing timestamp');
    }
  } catch (catalogError) {
    console.warn(`   ⚠️  Could not query catalog API: ${catalogError.message}`);
    if (catalogError.response) {
      console.warn(`   Status: ${catalogError.response.status} ${catalogError.response.statusText}`);
      if (catalogError.response.data) {
        const errorData = catalogError.response.data;
        console.warn(`   Error details:`, typeof errorData === 'object' ? JSON.stringify(errorData, null, 2).substring(0, 300) : errorData.substring(0, 300));
      }
    }
    console.warn('   Will proceed with Process API (timestamp may be approximate)');
    // Continue with Process API - timestamp will be approximate
  }
  
  // Step 2: Request image from Sentinel Hub Process API
  // Sentinel Hub returns image directly as PNG
  let imageBuffer;
  let contentType = 'image/png';
  
  try {
    const response = await axios.post(
      `${SATELLITE_API_URL}/process`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`, // OAuth2 Bearer token
          'Content-Type': 'application/json',
          'Accept': 'image/png', // Request PNG format
        },
        timeout: API_TIMEOUT_MS,
        responseType: 'arraybuffer', // Get image as buffer
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    
    // Process Sentinel Hub response
    imageBuffer = Buffer.from(response.data);
    contentType = response.headers['content-type'] || 'image/png';
    console.log(`   ✅ Received image: ${imageBuffer.length} bytes, type: ${contentType}`);
    
    // Debug: Check image format
    if (imageBuffer.length > 0) {
      try {
        const metadata = await sharp(imageBuffer).metadata();
        console.log(`   📊 Image metadata: ${metadata.width}x${metadata.height}, channels: ${metadata.channels}, format: ${metadata.format}`);
      } catch (metadataError) {
        console.warn(`   ⚠️  Could not read image metadata: ${metadataError.message}`);
      }
    }
  } catch (error) {
    // Check if this is an axios error (HTTP error)
    if (error.response) {
      console.error('❌ Sentinel Hub API error:', error.response.status, error.response.statusText);
      console.error('   Error URL:', error.config?.url);
      console.error('   Error details:', error.response.data ? Buffer.from(error.response.data).toString() : error.message);
      
      if (error.response.status === 401 || error.response.status === 403) {
        throw new Error(
          `Sentinel Hub authentication failed (${error.response.status}). ` +
          `Please verify your SATELLITE_API_KEY is a valid OAuth2 Bearer token. ` +
          `Get your token from: https://docs.sentinel-hub.com/api/latest/api/overview/authentication/`
        );
      } else if (error.response.status === 400) {
        throw new Error(
          `Sentinel Hub bad request (400). ` +
          `Check request structure: ${error.response.data ? Buffer.from(error.response.data).toString() : 'Unknown error'}`
        );
      }
      
      throw new Error(`Sentinel Hub API error: ${error.response.status} - ${error.message}`);
    } else {
      // This is not an axios error (could be metadata processing error, network error, etc.)
      console.error('❌ Sentinel Hub processing error:', error.message);
      console.error('   Error stack:', error.stack);
      throw new Error(`Sentinel Hub processing error: ${error.message}`);
    }
  }
  
  // Calculate average NDVI from image buffer BEFORE uploading
  console.log('   Calculating NDVI from image pixels...');
  const avgNDVI = await calculateAverageNDVI(imageBuffer);
  console.log(`   ✅ Average NDVI: ${avgNDVI.toFixed(4)}`);
  
  // Upload to storage provider (Firebase primary, Cloudinary fallback)
  const storagePath = `reports/${farmer_ID}/${job_ID}/ndvi_map.png`;
  const storageUrl = await uploadImageToStorage(imageBuffer, storagePath, contentType);
  console.log(`   ✅ Image uploaded to storage provider: ${storageUrl}`);
  
  // Use actual satellite acquisition date if found, otherwise use current time (approximate)
  const finalTimestamp = satelliteAcquisitionDate || new Date().toISOString();
  
  return {
    ndvi_map_url: storageUrl,
    avg_ndvi: avgNDVI,
    health_score: Math.round(avgNDVI * 100),
    raw_data: {
      provider: 'sentinel_hub',
      bbox: bbox,
      timestamp: finalTimestamp,
    },
    provider: 'sentinel_hub',
    timestamp: finalTimestamp, // Actual satellite image acquisition date
    storage_path: storagePath,
  };
}

async function fetchPlanetLabsData(fieldGeometry, farmer_ID, job_ID) {
  console.log('🛰️  Fetching Planet Labs satellite data...');
  
  // Planet Labs API v1 implementation
  const bbox = calculateBoundingBox(fieldGeometry);
  const polygon = {
    type: 'Polygon',
    coordinates: [fieldGeometry.map(coord => [coord[1], coord[0]])], // Planet uses [lon, lat]
  };
  
  // Search for available imagery using Planet Labs Data API
  console.log(`   Searching for imagery in bbox: [${bbox.join(', ')}]`);
  
  let searchResponse;
  let latestImage;
  
  try {
    // Planet Labs quick search endpoint
    const searchRequest = {
      item_types: ['PSScene'],
      filter: {
        type: 'AndFilter',
        config: [
          {
            type: 'GeometryFilter',
            field_name: 'geometry',
            config: polygon,
          },
          {
            type: 'DateRangeFilter',
            field_name: 'acquired',
            config: {
              gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // Last 90 days (wider search)
              lte: new Date().toISOString(),
            },
          },
          {
            type: 'RangeFilter',
            field_name: 'cloud_cover',
            config: {
              lte: 0.5, // Max 50% cloud cover (more lenient)
            },
          },
        ],
      },
    };
    
    console.log(`   Request URL: ${SATELLITE_API_URL}/data/v1/quick-search`);
    console.log(`   Request filter type: ${searchRequest.filter.type}`);
    
    searchResponse = await axios.post(
      `${SATELLITE_API_URL}/data/v1/quick-search`,
      searchRequest,
      {
        headers: {
          'Authorization': `api-key ${SATELLITE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: API_TIMEOUT_MS,
      }
    );
    
    console.log(`   ✅ Found ${searchResponse.data?.features?.length || 0} images`);
  } catch (searchError) {
    console.error('\n❌ Planet Labs search error details:');
    console.error('   Status:', searchError.response?.status);
    console.error('   Status Text:', searchError.response?.statusText);
    console.error('   URL:', searchError.config?.url);
    console.error('   Method:', searchError.config?.method);
    console.error('   Request Data:', JSON.stringify(searchError.config?.data || {}, null, 2));
    console.error('   Response Data:', JSON.stringify(searchError.response?.data || {}, null, 2));
    console.error('   Error Message:', searchError.message);
    
    // Provide detailed error information
    if (searchError.response?.status === 405) {
      const errorMessage = `Planet Labs API returned 405 Method Not Allowed.\n` +
        `Endpoint tried: POST ${searchError.config?.url}\n` +
        `Response: ${JSON.stringify(searchError.response?.data || {})}\n` +
        `Please check Planet Labs API documentation for the correct endpoint and method.\n` +
        `Current API URL: ${SATELLITE_API_URL}`;
      throw new Error(errorMessage);
    } else if (searchError.response?.status === 401 || searchError.response?.status === 403) {
      throw new Error(
        `Planet Labs API authentication failed (${searchError.response?.status}). ` +
        `Please verify your SATELLITE_API_KEY is correct and has proper permissions.`
      );
    } else if (searchError.response?.status === 400) {
      throw new Error(
        `Planet Labs API bad request (400). ` +
        `Check filter structure: ${JSON.stringify(searchError.response?.data || {})}`
      );
    }
    
    throw new Error(`Planet Labs API error: ${searchError.response?.status || 'Unknown'} - ${searchError.message}`);
  }
  
  // Get the most recent image
  latestImage = searchResponse.data?.features?.[0];
  
  if (!latestImage || !latestImage.id) {
    throw new Error('No satellite imagery found for the specified field and time range. Try expanding the date range or cloud cover filter.');
  }
  
  console.log(`   Using image: ${latestImage.id}, acquired: ${latestImage.properties?.acquired}`);
  
  // Get asset URL for visual/analytic imagery
  // Planet Labs provides different asset types: visual, analytic, ndvi, etc.
  // First, activate the item if needed, then get the asset URL
  const itemId = latestImage.id;
  
  // Request visual/analytic asset activation
  const assetType = 'visual'; // Start with visual, can request analytic for NDVI calculation
  const activateResponse = await axios.post(
    `${SATELLITE_API_URL}/data/v1/item-types/PSScene/items/${itemId}/assets`,
    {},
    {
      headers: {
        'Authorization': `api-key ${SATELLITE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: API_TIMEOUT_MS,
    }
  );
  
  // Get the asset URL - Planet Labs provides _links with activation status
  const assetLinks = activateResponse.data?.[assetType]?._links;
  if (!assetLinks || !assetLinks.activate) {
    throw new Error(`Unable to activate asset for image ${itemId}`);
  }
  
  // For NDVI, we need to calculate it from the image bands
  // Planet Labs provides analytic assets with NIR and Red bands
  // For now, request the visual asset and we'll calculate NDVI from metadata
  // In production, you'd want to request analytic assets and calculate NDVI from bands
  
  // Get the download URL once activated
  const thumbnailUrl = latestImage?._links?.thumbnail || latestImage?._links?.assets?.visual?.href;
  
  if (!thumbnailUrl) {
    throw new Error(`No image URL available for item ${itemId}`);
  }
  
  // Download and store via storage helper (Firebase primary, Cloudinary fallback)
  const firebaseStorageUrl = await downloadAndStoreImage(
    thumbnailUrl,
    `reports/${farmer_ID}/${job_ID}/ndvi_map.png`,
    farmer_ID,
    job_ID,
    'ndvi_map'
  );
  
  // Calculate NDVI from Planet Labs analytic bands
  // Must process actual NIR and Red band data - no fallback
  const avgNDVI = await calculatePlanetLabsNDVI(itemId, fieldGeometry, farmer_ID, job_ID);
  
  return {
    ndvi_map_url: firebaseStorageUrl,
    avg_ndvi: avgNDVI,
    health_score: Math.round(avgNDVI * 100),
    raw_data: {
      image_id: itemId,
      image_metadata: latestImage,
      asset_activation: activateResponse.data,
    },
    provider: 'planet_labs',
    timestamp: latestImage.properties?.acquired || new Date().toISOString(),
    storage_path: `reports/${farmer_ID}/${job_ID}/ndvi_map.png`,
  };
}

async function calculatePlanetLabsNDVI(itemId, fieldGeometry, farmer_ID, job_ID) {
  // Calculate NDVI from Planet Labs analytic bands
  // Planet Labs provides NIR and Red bands that we need to download and process
  
  console.log('   Calculating NDVI from Planet Labs analytic bands...');
  
  try {
    // Request analytic assets (contains NIR and Red bands)
    const assetResponse = await axios.get(
      `${SATELLITE_API_URL}/data/v1/item-types/PSScene/items/${itemId}/assets`,
      {
        headers: {
          'Authorization': `api-key ${SATELLITE_API_KEY}`,
        },
        timeout: API_TIMEOUT_MS,
      }
    );
    
    const assets = assetResponse.data;
    
    // Check for analytic asset (contains NIR and Red bands)
    if (!assets.analytic || !assets.analytic._links) {
      throw new Error('Analytic asset not available for this image. Cannot calculate NDVI.');
    }
    
    // Activate analytic asset if needed
    if (assets.analytic.status === 'inactive') {
      console.log('   Activating analytic asset...');
      await axios.post(
        assets.analytic._links.activate,
        {},
        {
          headers: {
            'Authorization': `api-key ${SATELLITE_API_KEY}`,
          },
          timeout: API_TIMEOUT_MS,
        }
      );
      
      // Wait for activation (poll until ready)
      let activated = false;
      let attempts = 0;
      const maxAttempts = 30; // 30 attempts = ~5 minutes
      
      while (!activated && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        
        const statusResponse = await axios.get(
          `${SATELLITE_API_URL}/data/v1/item-types/PSScene/items/${itemId}/assets`,
          {
            headers: {
              'Authorization': `api-key ${SATELLITE_API_KEY}`,
            },
            timeout: API_TIMEOUT_MS,
          }
        );
        
        if (statusResponse.data.analytic.status === 'active') {
          activated = true;
          console.log('   Analytic asset activated successfully');
        } else {
          attempts++;
          console.log(`   Waiting for activation... (attempt ${attempts}/${maxAttempts})`);
        }
      }
      
      if (!activated) {
        throw new Error('Timeout waiting for analytic asset activation');
      }
    }
    
    // Get the download URL for analytic asset
    const analyticUrl = assets.analytic._links.self;
    
    // Download analytic image (contains NIR and Red bands)
    console.log('   Downloading analytic bands...');
    const analyticResponse = await axios.get(analyticUrl, {
      responseType: 'arraybuffer',
      timeout: 120000, // 2 minutes for large images
      headers: {
        'Authorization': `api-key ${SATELLITE_API_KEY}`,
      },
    });
    
    const analyticBuffer = Buffer.from(analyticResponse.data);
    console.log(`   Downloaded analytic image: ${analyticBuffer.length} bytes`);
    
    // Process the analytic image to extract NIR and Red bands
    // Planet Labs analytic images typically have 4 bands: Red, Green, Blue, NIR (in that order)
    const { data, info } = await sharp(analyticBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    console.log(`   Analytic image: ${info.width}x${info.height}, channels: ${info.channels}`);
    
    if (info.channels < 4) {
      throw new Error(`Expected 4 channels in analytic image, got ${info.channels}`);
    }
    
    // Extract Red (band 0) and NIR (band 3) values
    const numPixels = info.width * info.height;
    const ndviValues = [];
    
    for (let i = 0; i < numPixels; i++) {
      const idx = i * info.channels;
      const red = data[idx];      // Band 0: Red
      const nir = data[idx + 3];  // Band 3: NIR
      
      // Calculate NDVI: (NIR - Red) / (NIR + Red)
      const denominator = nir + red;
      if (denominator > 0) {
        const ndvi = (nir - red) / denominator;
        // Clamp to valid range
        ndviValues.push(Math.max(-1, Math.min(1, ndvi)));
      }
    }
    
    // Calculate average NDVI
    const sum = ndviValues.reduce((acc, val) => acc + val, 0);
    const avgNDVI = sum / ndviValues.length;
    
    console.log(`   Average NDVI: ${avgNDVI.toFixed(4)} (from ${ndviValues.length} pixels)`);
    
    // Clamp to valid range (crop fields typically 0-1)
    return Math.max(0, Math.min(1, avgNDVI));
    
  } catch (error) {
    console.error('❌ Error calculating NDVI from Planet Labs:', error.message);
    throw new Error(`Failed to calculate NDVI from Planet Labs bands: ${error.message}`);
  }
}

// REMOVED: getMockSatelliteData - Production only, no mock data

function calculateBoundingBox(geometry) {
  const lats = geometry.map(coord => coord[0]);
  const lons = geometry.map(coord => coord[1]);
  return [
    Math.min(...lons), // min lon
    Math.min(...lats), // min lat
    Math.max(...lons), // max lon
    Math.max(...lats), // max lat
  ];
}

async function calculateAverageNDVI(imageBuffer) {
  // Calculate NDVI from Sentinel Hub image buffer
  // Sentinel Hub returns an image where pixel values represent NDVI
  // The image is typically in a format where we can extract pixel values
  
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
    throw new Error('Cannot calculate NDVI: Invalid image buffer provided');
  }
  
  try {
    console.log('📊 Processing NDVI image buffer...');
    
    // Use sharp to extract pixel data from the image
    // Sentinel Hub NDVI images are typically grayscale or RGB where values represent NDVI
    const { data, info } = await sharp(imageBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    console.log(`   Image dimensions: ${info.width}x${info.height}, channels: ${info.channels}`);
    
    // For Sentinel Hub NDVI images, typically:
    // - Single channel: pixel value directly represents NDVI (0-255 scaled to 0-1)
    // - Multi-channel: first channel might be NDVI
    const pixels = [];
    const numPixels = info.width * info.height;
    
    if (info.channels === 1) {
      // Single channel UINT8 - values are NDVI scaled from [-1, 1] to [0, 255]
      // Reverse scaling: (pixelValue / 255) * 2 - 1 gives original NDVI [-1, 1]
      // Then clamp to [0, 1] for typical crop NDVI
      for (let i = 0; i < numPixels; i++) {
        const pixelValue = data[i]; // UINT8 value 0-255
        // Reverse the scaling: (pixelValue / 255) * 2 - 1 to get NDVI [-1, 1]
        const ndviValue = (pixelValue / 255.0) * 2 - 1;
        // Clamp to [0, 1] for crop NDVI (typical range for vegetation)
        pixels.push(Math.max(0, Math.min(1, ndviValue)));
      }
    } else if (info.channels >= 3) {
      // RGB image (3 channels) - colorized NDVI visualization
      // Extract NDVI estimate from RGB color values
      // Our colormap: Red/Brown (low) -> Yellow -> Light Green -> Dark Green (high)
      // We can estimate NDVI from the green channel intensity and color composition
      // Cloud pixels: [200, 220, 240] (light blue-gray) - should be skipped
      // Cloud shadow pixels: [100, 100, 100] (dark gray) - should be skipped
      // No data pixels: [255, 255, 255] (white) - should be skipped
      for (let i = 0; i < numPixels; i++) {
        const idx = i * info.channels;
        const r = data[idx];     // Red channel
        const g = data[idx + 1]; // Green channel
        const b = data[idx + 2]; // Blue channel
        
        // Skip cloud pixels (light blue-gray: ~200, 220, 240)
        if (r >= 190 && r <= 210 && g >= 210 && g <= 230 && b >= 230 && b <= 250) {
          continue; // Skip cloud pixels
        }
        
        // Skip cloud shadow pixels (dark gray: ~100, 100, 100)
        if (r >= 90 && r <= 110 && g >= 90 && g <= 110 && b >= 90 && b <= 110) {
          continue; // Skip shadow pixels
        }
        
        // Skip no data pixels (white: 255, 255, 255)
        if (r === 255 && g === 255 && b === 255) {
          continue; // Skip no data
        }
        
        // Skip water pixels (dark blue: 0, 0, 128)
        if (r === 0 && g === 0 && b === 128) {
          continue; // Skip water for NDVI calculation
        }
        
        // Estimate NDVI from RGB colormap:
        // - Red/Brown (low NDVI 0.0-0.2): R high, G medium, B low
        // - Yellow (0.2-0.4): R=255, G high, B=0
        // - Light Green (0.4-0.6): R low, G high, B low
        // - Dark Green (0.6-1.0): R low, G high, B low
        
        let estimatedNDVI;
        if (r > 200 && g < 100) {
          // Red/Brown range: very low NDVI (0.0-0.2)
          estimatedNDVI = (1 - (r / 255.0)) * 0.2;
        } else if (r === 255 && b === 0) {
          // Yellow range: low-medium NDVI (0.2-0.4)
          estimatedNDVI = 0.2 + (g / 255.0) * 0.2;
        } else if (g > r && g > b) {
          // Green range: medium to high NDVI (0.4-1.0)
          // Higher green intensity = higher NDVI
          const greenIntensity = g / 255.0;
          estimatedNDVI = 0.4 + greenIntensity * 0.6;
        } else {
          // Fallback: estimate from overall brightness
          estimatedNDVI = (g / 255.0) * 0.8 + 0.2;
        }
        
        pixels.push(Math.max(0, Math.min(1, estimatedNDVI)));
      }
    } else {
      throw new Error(`Unexpected image format: ${info.channels} channels`);
    }
    
    // Calculate average NDVI
    const sum = pixels.reduce((acc, val) => acc + val, 0);
    const avgNDVI = sum / pixels.length;
    
    // Filter out invalid values (NaN, Infinity, etc.)
    const validPixels = pixels.filter(v => isFinite(v) && v >= -1 && v <= 1);
    const validAvgNDVI = validPixels.length > 0 
      ? validPixels.reduce((acc, val) => acc + val, 0) / validPixels.length
      : 0;
    
    console.log(`   Average NDVI: ${validAvgNDVI.toFixed(4)} (from ${validPixels.length}/${numPixels} valid pixels)`);
    
    // Clamp to valid NDVI range (-1 to 1, but crop fields typically 0-1)
    return Math.max(0, Math.min(1, validAvgNDVI));
    
  } catch (error) {
    console.error('❌ Error processing NDVI image:', error.message);
    throw new Error(`Failed to calculate NDVI from image: ${error.message}`);
  }
}

// Production Weather API Functions - PRODUCTION ONLY, NO MOCK DATA
async function fetchWeatherData(lat, lon) {
  console.log(`🌤️  Fetching weather data for location (${lat}, ${lon})...`);
  
  if (!WEATHER_API_KEY) {
    throw new Error('WEATHER_API_KEY is required. Cannot fetch weather data without API key.');
  }
  
  if (WEATHER_API_PROVIDER === 'openweathermap') {
    return await fetchOpenWeatherMapData(lat, lon);
  } else if (WEATHER_API_PROVIDER === 'weatherapi') {
    return await fetchWeatherAPIData(lat, lon);
  } else {
    throw new Error(`Unknown weather provider: ${WEATHER_API_PROVIDER}. Must be 'openweathermap' or 'weatherapi'.`);
  }
}

async function fetchOpenWeatherMapData(lat, lon) {
  // Fetch current weather and 5-day forecast
  const [currentResponse, forecastResponse] = await Promise.all([
    axios.get(`${WEATHER_API_URL}/weather`, {
      params: {
        lat,
        lon,
        appid: WEATHER_API_KEY,
        units: 'metric',
      },
      timeout: API_TIMEOUT_MS,
    }),
    axios.get(`${WEATHER_API_URL}/forecast`, {
      params: {
        lat,
        lon,
        appid: WEATHER_API_KEY,
        units: 'metric',
      },
      timeout: API_TIMEOUT_MS,
    }),
  ]);
  
  const current = currentResponse.data;
  const forecastList = forecastResponse.data.list || [];
  
  // Process 5-day forecast (OpenWeatherMap provides 3-hour intervals)
  const dailyForecast = {};
  forecastList.forEach((item) => {
    const date = new Date(item.dt * 1000).toISOString().split('T')[0];
    if (!dailyForecast[date] || new Date(item.dt * 1000).getHours() === 12) {
      dailyForecast[date] = {
        date: new Date(item.dt * 1000).toISOString(),
        temp: Math.round(item.main.temp),
        rainfall: item.rain ? item.rain['3h'] || 0 : 0,
        humidity: item.main.humidity,
        description: item.weather[0]?.description || '',
      };
    } else {
      // Update rainfall if higher
      if (item.rain) {
        dailyForecast[date].rainfall += item.rain['3h'] || 0;
      }
    }
  });
  
  const forecast_5day = Object.values(dailyForecast).slice(0, 5);
  
  return {
    forecast_5day,
    current: {
      temp: Math.round(current.main.temp),
      humidity: current.main.humidity,
      rainfall_today: forecast_5day[0]?.rainfall || 0,
      description: current.weather[0]?.description || '',
      wind_speed: current.wind?.speed || 0,
    },
    provider: 'openweathermap',
    timestamp: new Date().toISOString(),
    location: {
      lat: current.coord.lat,
      lon: current.coord.lon,
    },
  };
}

async function fetchWeatherAPIData(lat, lon) {
  // WeatherAPI.com implementation
  const response = await axios.get(`${WEATHER_API_URL}/forecast.json`, {
    params: {
      key: WEATHER_API_KEY,
      q: `${lat},${lon}`,
      days: 5,
      aqi: 'no',
      alerts: 'no',
    },
    timeout: API_TIMEOUT_MS,
  });
  
  const data = response.data;
  
  const forecast_5day = data.forecast?.forecastday?.map((day) => ({
    date: day.date,
    temp: Math.round(day.day.avgtemp_c),
    rainfall: day.day.totalprecip_mm,
    humidity: day.day.avghumidity,
    description: day.day.condition?.text || '',
  })) || [];
  
  return {
    forecast_5day,
    current: {
      temp: Math.round(data.current.temp_c),
      humidity: data.current.humidity,
      rainfall_today: data.forecast?.forecastday?.[0]?.day?.totalprecip_mm || 0,
      description: data.current.condition?.text || '',
      wind_speed: data.current.wind_kph || 0,
    },
    provider: 'weatherapi',
    timestamp: new Date().toISOString(),
    location: {
      lat: data.location.lat,
      lon: data.location.lon,
    },
  };
}

// REMOVED: getMockWeatherData - Production only, no mock data

// Production NDVI Calculation
function calculateNDVI(nirData, redData) {
  console.log('📊 Calculating NDVI...');
  
  // Handle different data formats
  let nir, red;
  
  if (typeof nirData === 'number' && typeof redData === 'number') {
    // Direct numeric values
    nir = nirData;
    red = redData;
  } else if (nirData?.length && redData?.length) {
    // Array of pixel values - calculate average
    nir = Array.isArray(nirData) ? nirData.reduce((a, b) => a + b, 0) / nirData.length : nirData;
    red = Array.isArray(redData) ? redData.reduce((a, b) => a + b, 0) / redData.length : redData;
  } else {
    // Fallback calculation
    console.warn('⚠️  NDVI data format not recognized, using default calculation');
    nir = 800; // Typical NIR reflectance value
    red = 600; // Typical Red reflectance value
  }
  
  // NDVI formula: (NIR - Red) / (NIR + Red)
  const ndvi = (nir - red) / (nir + red);
  
  // Clamp between -1 and 1 (typical range), but usually crop fields are 0-1
  return Math.max(-1, Math.min(1, ndvi));
}

// Production Anomaly Detection
function detectAnomalies(currentNDVI, historicalAverage) {
  console.log('🔍 Detecting anomalies...');
  console.log(`   Current NDVI: ${currentNDVI.toFixed(3)}, Historical Average: ${historicalAverage.toFixed(3)}`);
  
  const ndviDifference = currentNDVI - historicalAverage;
  const percentDifference = (ndviDifference / historicalAverage) * 100;
  
  const stressAreas = [];
  let overallHealth = 'good';
  
  // Detect stress based on NDVI thresholds
  if (currentNDVI < 0.3) {
    overallHealth = 'critical';
    stressAreas.push({
      location: 'entire_field',
      severity: 'critical',
      area_percent: 100,
      description: 'Very low vegetation index indicates severe stress or bare ground',
    });
  } else if (currentNDVI < 0.5) {
    overallHealth = 'poor';
    stressAreas.push({
      location: 'entire_field',
      severity: 'high',
      area_percent: 100,
      description: 'Low vegetation index indicates significant stress',
    });
  } else if (percentDifference < -15) {
    // Significant drop from historical average
    overallHealth = 'needs_attention';
    stressAreas.push({
      location: 'multiple_areas',
      severity: 'moderate',
      area_percent: Math.abs(percentDifference),
      description: `NDVI is ${Math.abs(percentDifference).toFixed(1)}% below historical average`,
    });
  } else if (percentDifference < -10) {
    overallHealth = 'monitor';
    stressAreas.push({
      location: 'localized',
      severity: 'low',
      area_percent: Math.abs(percentDifference),
      description: `NDVI is ${Math.abs(percentDifference).toFixed(1)}% below historical average`,
    });
  }
  
  return {
    stress_areas: stressAreas,
    overall_health: overallHealth,
    ndvi_comparison: {
      current: currentNDVI,
      historical_average: historicalAverage,
      difference: ndviDifference,
      percent_change: percentDifference,
    },
  };
}

// Fetch historical NDVI average for a field
async function getHistoricalNDVI(farmer_ID, field_ID) {
  try {
    // Check if we have historical reports for this field
    const reportsRef = db.collection('users')
      .doc(farmer_ID)
      .collection('reports')
      .where('field_ID', '==', field_ID)
      .orderBy('generated_at', 'desc')
      .limit(10); // Get last 10 reports
    
    const snapshot = await reportsRef.get();
    
    if (snapshot.empty) {
      return null; // No historical data
    }
    
    const historicalNDVIs = [];
    snapshot.forEach((doc) => {
      const report = doc.data();
      if (report.ndvi_analysis?.average_ndvi) {
        historicalNDVIs.push(report.ndvi_analysis.average_ndvi);
      }
    });
    
    if (historicalNDVIs.length === 0) {
      return null;
    }
    
    // Calculate average
    const average = historicalNDVIs.reduce((a, b) => a + b, 0) / historicalNDVIs.length;
    console.log(`📊 Historical NDVI average: ${average.toFixed(3)} (from ${historicalNDVIs.length} previous reports)`);
    return average;
    
  } catch (error) {
    console.warn('⚠️  Could not fetch historical NDVI:', error.message);
    return null; // Fallback to default
  }
}

// Production Recommendation Generation
function generateRecommendation(ndviData, weatherData, anomalies, cropType) {
  console.log('🤖 Generating AI recommendations...');
  console.log(`   Crop Type: ${cropType}, Health Score: ${ndviData.health_score}, Overall Health: ${anomalies.overall_health}`);
  
  const recommendations = [];
  const healthScore = ndviData.health_score || 0;
  const avgNDVI = ndviData.avg_ndvi || 0;
  const overallHealth = anomalies.overall_health || 'good';
  
  // Priority 1: Critical health issues
  if (overallHealth === 'critical' || healthScore < 40) {
    recommendations.push({
      type: 'immediate_action',
      priority: 'critical',
      message: 'Immediate attention required',
      details: 'Field health is critically low. Immediate intervention needed to prevent crop loss.',
      action: 'Contact agricultural expert immediately. Consider emergency irrigation and soil assessment.',
      urgency_hours: 24,
    });
  }
  
  // Priority 2: Water stress based on anomalies
  if (anomalies.stress_areas && anomalies.stress_areas.length > 0) {
    const criticalStress = anomalies.stress_areas.find(area => area.severity === 'critical' || area.severity === 'high');
    const moderateStress = anomalies.stress_areas.find(area => area.severity === 'moderate');
    
    if (criticalStress) {
      recommendations.push({
        type: 'irrigation',
        priority: 'high',
        message: 'Urgent irrigation needed',
        details: `${criticalStress.description}. Water stress detected across ${criticalStress.area_percent.toFixed(1)}% of field.`,
        action: `Apply 25-30mm irrigation within 24-48 hours. Focus on ${criticalStress.location === 'entire_field' ? 'entire field' : criticalStress.location} areas.`,
        urgency_hours: 48,
      });
    } else if (moderateStress) {
      recommendations.push({
        type: 'irrigation',
        priority: 'high',
        message: 'Irrigation recommended',
        details: `${moderateStress.description}. Moderate water stress detected.`,
        action: 'Apply 20-25mm irrigation within 2-3 days. Monitor soil moisture levels.',
        urgency_hours: 72,
      });
    }
  }
  
  // Priority 3: Weather-based recommendations
  if (weatherData && weatherData.forecast_5day) {
    const totalRainfall = weatherData.forecast_5day.reduce((sum, day) => sum + (day.rainfall || 0), 0);
    const lowRainfallDays = weatherData.forecast_5day.filter(day => (day.rainfall || 0) < 2).length;
    const highTempDays = weatherData.forecast_5day.filter(day => (day.temp || 0) > 35).length;
    
    if (totalRainfall < 5 && lowRainfallDays >= 4 && anomalies.stress_areas.length > 0) {
      recommendations.push({
        type: 'water_management',
        priority: 'high',
        message: 'Extended dry period forecast',
        details: `Next 5 days show minimal rainfall (${totalRainfall.toFixed(1)}mm total). Field already showing stress signs.`,
        action: 'Schedule proactive irrigation. Maintain soil moisture above 40% to prevent further stress.',
        urgency_hours: 96,
      });
    } else if (highTempDays >= 3 && avgNDVI < 0.6) {
      recommendations.push({
        type: 'heat_management',
        priority: 'medium',
        message: 'High temperature alert',
        details: `${highTempDays} days of high temperatures (>35°C) forecasted. This can increase water stress.`,
        action: 'Increase irrigation frequency during high temperature days. Consider applying mulch to retain soil moisture.',
        urgency_hours: 120,
      });
    }
  }
  
  // Priority 4: Nutrient management
  if (healthScore < 60 && healthScore >= 40 && overallHealth !== 'critical') {
    recommendations.push({
      type: 'fertilizer',
      priority: 'medium',
      message: 'Nutrient management needed',
      details: `Field health score (${healthScore}) is below optimal. Consider nutrient assessment.`,
      action: 'Conduct soil test. Apply balanced fertilizer (NPK 20-20-20) based on soil test results. Consider foliar feeding for quick nutrient uptake.',
      urgency_hours: 168, // 1 week
    });
  }
  
  // Priority 5: Monitoring recommendations
  if (overallHealth === 'monitor' || (healthScore >= 60 && healthScore < 75)) {
    recommendations.push({
      type: 'monitoring',
      priority: 'low',
      message: 'Continue monitoring',
      details: 'Field health is acceptable but needs regular monitoring. Watch for any changes in vegetation patterns.',
      action: 'Schedule next analysis in 7-10 days. Maintain current irrigation and fertilization schedule.',
      urgency_hours: 168,
    });
  }
  
  // Default: All good
  if (recommendations.length === 0 || (overallHealth === 'good' && healthScore >= 75)) {
    recommendations.push({
      type: 'maintenance',
      priority: 'low',
      message: 'Field health is excellent',
      details: `Field is performing well with health score of ${healthScore}. Continue standard maintenance practices.`,
      action: 'Maintain current irrigation, fertilization, and pest control schedules. Schedule next analysis in 14 days.',
      urgency_hours: 336, // 2 weeks
    });
  }
  
  // Sort by priority (critical > high > medium > low)
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return {
    primary_recommendation: recommendations[0],
    all_recommendations: recommendations,
    generated_at: new Date().toISOString(),
  };
}

async function processJob(job) {
  try {
    console.log(`\n🚀 Starting job processing: ${job.job_ID}`);
    
    // Update job status to PROCESSING
    const jobRef = db.collection('jobs').doc(job.job_ID);
    await jobRef.update({
      status: 'PROCESSING',
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    // Also update in user's subcollection
    if (job.farmer_ID) {
      const userJobRef = db.collection('users').doc(job.farmer_ID).collection('jobs').doc(job.job_ID);
      await userJobRef.update({
        status: 'PROCESSING',
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    
    // Step 1: Fetch field data
    console.log(`📍 Fetching field data for: ${job.field_ID}`);
    
    // Validate field_ID
    if (!job.field_ID || typeof job.field_ID !== 'string' || job.field_ID.trim().length === 0) {
      throw new Error(`Invalid field_ID: "${job.field_ID}". Field ID must be a non-empty string.`);
    }
    
    // Validate farmer_ID
    if (!job.farmer_ID || typeof job.farmer_ID !== 'string' || job.farmer_ID.trim().length === 0) {
      throw new Error(`Invalid farmer_ID: "${job.farmer_ID}". Farmer ID must be a non-empty string.`);
    }
    
    // Clean field_ID (remove any invalid characters that might break Firestore path)
    const cleanFieldID = job.field_ID.trim();
    
    // Additional validation: Firestore document IDs have restrictions
    // They can't contain certain characters and should be reasonable length
    if (cleanFieldID.length < 1) {
      throw new Error(`Field ID is too short: "${cleanFieldID}". Field ID must be at least 1 character.`);
    }
    
    console.log(`   Using clean field_ID: "${cleanFieldID}"`);
    
    const fieldDoc = await db.collection('users').doc(job.farmer_ID).collection('fields').doc(cleanFieldID).get();
    
    if (!fieldDoc.exists) {
      // Try to list available fields for debugging
      const fieldsSnapshot = await db.collection('users').doc(job.farmer_ID).collection('fields').get();
      const availableFieldIds = [];
      fieldsSnapshot.forEach((doc) => {
        availableFieldIds.push(doc.id);
      });
      
      throw new Error(
        `Field "${cleanFieldID}" not found for farmer ${job.farmer_ID}. ` +
        `Available fields: ${availableFieldIds.length > 0 ? availableFieldIds.join(', ') : 'none'}`
      );
    }
    
    const fieldData = fieldDoc.data();
    const geometry = [
      [fieldData.lat1, fieldData.lon1],
      [fieldData.lat2, fieldData.lon2],
      [fieldData.lat3, fieldData.lon3],
      [fieldData.lat4, fieldData.lon4],
    ];
    
    // Calculate center point for weather API
    const centerLat = (fieldData.lat1 + fieldData.lat2 + fieldData.lat3 + fieldData.lat4) / 4;
    const centerLon = (fieldData.lon1 + fieldData.lon2 + fieldData.lon3 + fieldData.lon4) / 4;
    
    // Step 2: Parallel API calls
    console.log('📡 Making parallel API calls...');
    const [satelliteData, weatherData] = await Promise.all([
      fetchSatelliteData(geometry, job.farmer_ID, job.job_ID),
      fetchWeatherData(centerLat, centerLon),
    ]);
    
    // Step 3: Data processing
    console.log('🔄 Processing data...');
    
    // Extract NDVI values from satellite data
    const nirValue = typeof satelliteData.raw_data?.nir_band === 'number' 
      ? satelliteData.raw_data.nir_band 
      : satelliteData.raw_data?.nir_band?.length || (satelliteData.avg_ndvi || 0.65) * 1000;
    const redValue = typeof satelliteData.raw_data?.red_band === 'number'
      ? satelliteData.raw_data.red_band
      : satelliteData.raw_data?.red_band?.length || (satelliteData.avg_ndvi || 0.65) * 600;
    
    // Use provided average NDVI if available, otherwise calculate
    const ndviValue = satelliteData.avg_ndvi || calculateNDVI(nirValue, redValue);
    
    // Fetch historical average from previous reports
    const historicalAverage = await getHistoricalNDVI(job.farmer_ID, job.field_ID) || 0.68;
    
    const anomalies = detectAnomalies(ndviValue, historicalAverage);
    
    // Step 4: Fetch user language from Firestore
    let userLanguage = 'en';
    try {
      const userDoc = await db.collection('users').doc(job.farmer_ID).get();
      if (userDoc.exists) {
        userLanguage = userDoc.data().language || 'en';
      }
    } catch (error) {
      console.warn('Could not fetch user language, using default:', error.message);
    }
    
    // Step 5: Generate initial report with basic recommendations
    const cropType = 'wheat'; // Default, could be from field data or user profile
    const recommendations = generateRecommendation(satelliteData, weatherData, anomalies, cropType);
    
    // Prepare report data for AI analysis (reuse fieldData from Step 1)
    // Calculate field center location
    const fieldLocation = {
      lat: fieldData.lat1 ? (fieldData.lat1 + fieldData.lat2 + fieldData.lat3 + fieldData.lat4) / 4 : null,
      lon: fieldData.lon1 ? (fieldData.lon1 + fieldData.lon2 + fieldData.lon3 + fieldData.lon4) / 4 : null,
    };
    
    const fieldArea = fieldData.lat1 ? calculateArea(
      fieldData.lat1, fieldData.lon1,
      fieldData.lat2, fieldData.lon2,
      fieldData.lat3, fieldData.lon3,
      fieldData.lat4, fieldData.lon4
    ) : null;
    
    // Step 6: Generate AI recommendations using Gemini
    // CRITICAL: If NDVI > 0.5, skip AI generation - user must select crop first
    // AI will be generated by frontend after crop selection
    let aiRecommendations = null;
    const NDVI_THRESHOLD = 0.5;
    const hasGoodVegetation = ndviValue > NDVI_THRESHOLD;
    
    if (hasGoodVegetation) {
      console.log('🌾 NDVI > 0.5 detected - skipping automatic AI generation');
      console.log('   User must select crop first via frontend modal');
      console.log('   AI recommendations will be generated after crop selection');
      // Don't generate AI recommendations - wait for user to select crop
      aiRecommendations = null;
    } else {
      // NDVI <= 0.5: Generate general recommendations (no crop selection needed)
      try {
        const reportDataForAI = {
          field_ID: job.field_ID,
          field_name: job.field_ID,
          field_location: fieldLocation,
          field_area: fieldArea,
          ndvi_analysis: {
            average_ndvi: ndviValue,
            health_score: satelliteData.health_score,
            timestamp: satelliteData.timestamp,
          },
          weather_forecast: weatherData.forecast_5day,
          anomalies: anomalies,
          summary: {
            overall_health: anomalies.overall_health,
          },
        };
        
        console.log('🤖 Generating AI recommendations via Gemini (NDVI <= 0.5)...');
        console.log('   Field:', job.field_ID);
        console.log('   Farmer:', job.farmer_ID);
        console.log('   Language:', userLanguage);
        console.log('   NDVI:', ndviValue);
        console.log('   Health Score:', satelliteData.health_score);
        
        // Extract advisory_params from job if available (district, soil type, season, irrigation, etc.)
        const advisoryParams = job.advisory_params || null;
        if (advisoryParams) {
          console.log('📋 Found advisory params in job:', {
            state: advisoryParams.state,
            district: advisoryParams.district,
            soil_type: advisoryParams.soil_type,
            season: advisoryParams.season,
            has_irrigation: !!advisoryParams.irrigation_days_ago,
            has_manual_npk: !!advisoryParams.manual_npk,
            has_soil_card: !!advisoryParams.soil_health_card_text,
          });
        } else {
          console.log('ℹ️  No advisory params found in job - using defaults');
        }
        
        // Call AI recommendations endpoint (internal)
        // Use localhost for internal service-to-service calls, or API_URL if set
        const API_BASE_URL = process.env.API_URL || process.env.HAL_API_URL || 'http://localhost:5050';
        console.log('   Calling AI endpoint:', `${API_BASE_URL}/api/v1/ai-recommendations`);
        
        // Build request body with advisory_params if available
        const aiRequestBody = {
          reportData: reportDataForAI,
          farmer_ID: job.farmer_ID,
          field_ID: job.field_ID,
          language: userLanguage,
        };
        
        // Add advisory_params if available
        if (advisoryParams) {
          aiRequestBody.advisory_params = advisoryParams;
          // Also extract individual fields for backward compatibility
          if (advisoryParams.state) aiRequestBody.state = advisoryParams.state;
          if (advisoryParams.district) aiRequestBody.district = advisoryParams.district;
          if (advisoryParams.soil_type) aiRequestBody.soil_type = advisoryParams.soil_type;
          if (advisoryParams.season) aiRequestBody.season = advisoryParams.season;
          if (advisoryParams.manual_npk) aiRequestBody.manual_npk = advisoryParams.manual_npk;
          if (advisoryParams.irrigation_days_ago !== null && advisoryParams.irrigation_days_ago !== undefined) {
            aiRequestBody.irrigation_days_ago = advisoryParams.irrigation_days_ago;
          }
          if (advisoryParams.soil_health_card_text) {
            aiRequestBody.soil_health_card_text = advisoryParams.soil_health_card_text;
          }
        }
        
        const aiResponse = await axios.post(
          `${API_BASE_URL}/api/v1/ai-recommendations`,
          aiRequestBody,
          {
            timeout: 1200000, // 120 seconds for AI generation
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
        
        if (aiResponse.data?.recommendations && !aiResponse.data.recommendations.error) {
          aiRecommendations = aiResponse.data.recommendations;
          console.log('✅ AI recommendations generated successfully');
          console.log('   Recommended crops:', aiRecommendations.recommended_crops?.length || 0);
          console.log('   Best crop:', aiRecommendations.best_crop?.crop_name || 'N/A');
        } else {
          console.warn('⚠️  AI recommendations response missing data or has error');
          if (aiResponse.data?.recommendations?.error) {
            console.warn('   Error:', aiResponse.data.recommendations.error);
          }
        }
      } catch (aiError) {
        console.error('❌ Error generating AI recommendations:', aiError.message);
        if (aiError.response) {
          console.error('   Response status:', aiError.response.status);
          console.error('   Response data:', JSON.stringify(aiError.response.data, null, 2));
        }
        console.warn('   Continuing with basic recommendations');
        // Continue with basic recommendations if AI fails
      }
    }
    
    // Step 7: Generate final report with AI recommendations
    const report = {
      field_ID: job.field_ID,
      field_name: job.field_ID, // Field ID is the field name
      generated_at: admin.firestore.FieldValue.serverTimestamp(),
      ndvi_analysis: {
        average_ndvi: ndviValue,
        health_score: satelliteData.health_score,
        map_url: satelliteData.ndvi_map_url, // Storage URL (Firebase or fallback)
        storage_path: satelliteData.storage_path, // Storage path for reference
        provider: satelliteData.provider,
        timestamp: satelliteData.timestamp,
      },
      weather_forecast: weatherData.forecast_5day,
      weather_provider: weatherData.provider,
      anomalies: anomalies,
      recommendations: recommendations, // Basic recommendations (fallback)
      ai_recommendations: aiRecommendations, // AI-generated comprehensive recommendations
      field_location: fieldLocation,
      field_area: fieldArea,
      language: userLanguage,
      summary: {
        overall_health: anomalies.overall_health,
        primary_concern: recommendations.primary_recommendation.message,
        action_required: recommendations.primary_recommendation.priority !== 'low',
      },
    };
    
    // Step 6: Store report and update job status
    const reportRef = db.collection('reports').doc(job.job_ID);
    await reportRef.set(report);
    
    // Also save report reference in user's subcollection
    if (job.farmer_ID) {
      const userReportRef = db.collection('users').doc(job.farmer_ID).collection('reports').doc(job.job_ID);
      await userReportRef.set({
        ...report,
        job_ID: job.job_ID,
      });
    }
    
    // Update job status to COMPLETED
    await jobRef.update({
      status: 'COMPLETED',
      report_id: job.job_ID,
      completed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    // Also update in user's subcollection
    if (job.farmer_ID) {
      const userJobRef = db.collection('users').doc(job.farmer_ID).collection('jobs').doc(job.job_ID);
      await userJobRef.update({
        status: 'COMPLETED',
        report_id: job.job_ID,
        completed_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    
    console.log(`✅ Job ${job.job_ID} completed successfully!`);
    return report;
    
  } catch (error) {
    console.error(`❌ Error processing job ${job.job_ID}:`, error);
    
    // Update job status to FAILED
    const jobRef = db.collection('jobs').doc(job.job_ID);
    await jobRef.update({
      status: 'FAILED',
      error_message: error.message,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    // Also update in user's subcollection
    if (job.farmer_ID) {
      const userJobRef = db.collection('users').doc(job.farmer_ID).collection('jobs').doc(job.job_ID);
      await userJobRef.update({
        status: 'FAILED',
        error_message: error.message,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    
    throw error;
  }
}

// Worker loop: Poll for PENDING jobs with concurrency control
let activeJobs = 0;

async function workerLoop() {
  console.log('👷 Worker started - Polling for PENDING jobs...');
  console.log(`⚙️  Configuration:`, {
    poll_interval_ms: WORKER_POLL_INTERVAL_MS,
    max_concurrent_jobs: MAX_CONCURRENT_JOBS,
    satellite_provider: SATELLITE_API_PROVIDER,
    weather_provider: WEATHER_API_PROVIDER,
    satellite_api_configured: !!SATELLITE_API_KEY,
    weather_api_configured: !!WEATHER_API_KEY,
  });
  
  let pollCount = 0;
  
  while (true) {
    try {
      pollCount++;
      
      // Only fetch new jobs if we're under the concurrency limit
      if (activeJobs >= MAX_CONCURRENT_JOBS) {
        if (pollCount % 12 === 0) { // Log every 12 polls (~1 minute)
          console.log(`⏳ Worker waiting (${activeJobs}/${MAX_CONCURRENT_JOBS} jobs active)`);
        }
        await new Promise(resolve => setTimeout(resolve, WORKER_POLL_INTERVAL_MS));
        continue;
      }
      
      // Query for PENDING jobs (limit based on available capacity)
      const limit = MAX_CONCURRENT_JOBS - activeJobs;
      
      if (pollCount % 12 === 0) { // Log every 12 polls (~1 minute)
        console.log(`🔍 Polling for PENDING jobs (poll #${pollCount}, capacity: ${limit})...`);
      }
      
      const jobsRef = db.collection('jobs')
        .where('status', '==', 'PENDING')
        .limit(limit);
      
      const snapshot = await jobsRef.get();
      
      if (snapshot.empty) {
        // No pending jobs, wait before checking again
        if (pollCount % 12 === 0) {
          console.log(`✅ No PENDING jobs found (poll #${pollCount})`);
        }
        await new Promise(resolve => setTimeout(resolve, WORKER_POLL_INTERVAL_MS));
        continue;
      }
      
      console.log(`📋 Found ${snapshot.size} PENDING job(s)`);
      
      // Process jobs concurrently (up to MAX_CONCURRENT_JOBS)
      const processingPromises = snapshot.docs.map(async (jobDoc) => {
        const job = {
          job_ID: jobDoc.id,
          ...jobDoc.data(),
        };
        
        console.log(`🔄 Queuing job for processing: ${job.job_ID} (field: ${job.field_ID})`);
        
        activeJobs++;
        try {
          await processJob(job);
        } catch (jobError) {
          console.error(`❌ Job ${job.job_ID} failed:`, jobError.message);
          console.error('Job error stack:', jobError.stack);
        } finally {
          activeJobs--;
          console.log(`✅ Job ${job.job_ID} completed (${activeJobs}/${MAX_CONCURRENT_JOBS} active)`);
        }
      });
      
      // Don't wait for all jobs - let them process in background
      Promise.all(processingPromises).catch((error) => {
        console.error('❌ Error processing job batch:', error);
        console.error('Batch error stack:', error.stack);
      });
      
      // Small delay before checking for more jobs
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error('❌ Error in worker loop:', error);
      console.error('Worker loop error stack:', error.stack);
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

// Export workerLoop for use in server.js (combined mode)
export { workerLoop };

// Only auto-start if RUN_WORKER_STANDALONE env var is set (for standalone mode)
// Otherwise, it will be started from server.js
if (process.env.RUN_WORKER_STANDALONE === 'true') {
  // Start the worker
  console.log('🌱 HAL Job Worker Starting (standalone mode)...');
  workerLoop().catch((error) => {
    console.error('Fatal error in worker:', error);
    process.exit(1);
  });
}

