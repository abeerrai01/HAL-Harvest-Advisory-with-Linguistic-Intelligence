# NDVI Calculation Flow - Detailed Explanation

## What is NDVI?

**NDVI (Normalized Difference Vegetation Index)** is a numerical indicator used to assess vegetation health and density. It ranges from -1 to +1, where:
- **< 0.0**: Water, snow, or artificial surfaces (negative values)
- **0.0 - 0.2**: Bare soil, rocks, sparse vegetation
- **0.2 - 0.4**: Sparse vegetation, stressed crops
- **0.4 - 0.6**: Moderate vegetation, healthy crops
- **0.6 - 1.0**: Dense, healthy vegetation

## Core NDVI Formula

The fundamental formula for NDVI is:

```
NDVI = (NIR - Red) / (NIR + Red)
```

Where:
- **NIR** = Near-Infrared reflectance (Band 8 in Sentinel-2, Band 3 in Planet Labs)
- **Red** = Red light reflectance (Band 4 in Sentinel-2, Band 0 in Planet Labs)

This formula normalizes the difference between NIR and Red bands, producing a value between -1 and +1.

---

## NDVI Calculation Flow in HAL System

The system uses **two different satellite data providers** with different calculation approaches:

### 1. Sentinel Hub (Primary Method)

#### Step 1: Request Satellite Data
- **Location**: `src/worker.js` → `fetchSentinelHubData()`
- **API**: Sentinel Hub Process API
- **Bands Requested**: 
  - `B04` (Red band)
  - `B08` (NIR band)
  - `SCL` (Scene Classification Layer - for cloud detection)

#### Step 2: NDVI Calculation in Sentinel Hub (Evalscript)

The calculation happens **on the Sentinel Hub server** using an evalscript (lines 468-572):

```javascript
function evaluatePixel(samples) {
  const red = samples.B04;      // Red band reflectance
  const nir = samples.B08;      // NIR band reflectance
  const scl = samples.SCL;      // Scene Classification Layer
  
  // Step 2a: Cloud/Shadow Detection
  if (isCloud(scl)) {
    return [200, 220, 240];     // Light blue-gray for clouds
  }
  if (isCloudShadow(scl)) {
    return [100, 100, 100];     // Dark gray for shadows
  }
  if (isNoData(scl)) {
    return [255, 255, 255];    // White for no data
  }
  
  // Step 2b: Validate Spectral Data
  if (!red || !nir || red <= 0 || nir <= 0) {
    return [200, 200, 200];    // Light gray for invalid pixels
  }
  
  // Step 2c: Calculate NDVI
  const denominator = nir + red;
  if (denominator <= 0) {
    return [200, 200, 200];    // Invalid calculation
  }
  
  const ndvi = (nir - red) / denominator;
  const clampedNDVI = Math.max(-1, Math.min(1, ndvi));
  
  // Step 2d: Convert NDVI to RGB Color for Visualization
  const rgb = ndviToColor(clampedNDVI);
  return rgb;  // [R, G, B] colorized visualization
}
```

#### Step 3: Color Mapping (Visualization)

The `ndviToColor()` function converts NDVI values to RGB colors:

```javascript
function ndviToColor(ndvi) {
  if (ndvi < 0.0) {
    return [0, 0, 128];           // Blue (water)
  } else if (ndvi < 0.2) {
    // Red/Brown gradient (bare soil)
    return [139 + 116*t, 69 + 31*t, 19 + 12*t];
  } else if (ndvi < 0.4) {
    // Yellow gradient (sparse vegetation)
    return [255, 255 - 100*t, 0];
  } else if (ndvi < 0.6) {
    // Light Green gradient (moderate vegetation)
    return [144 - 44*t, 238 - 138*t, 144 - 44*t];
  } else {
    // Dark Green gradient (healthy vegetation)
    return [34 + 34*t, 139 + 99*t, 34 + 34*t];
  }
}
```

**Color Legend**:
- 🔵 **Blue**: Water (NDVI < 0.0)
- 🔴 **Red/Brown**: Bare soil (0.0 - 0.2)
- 🟡 **Yellow**: Sparse vegetation (0.2 - 0.4)
- 🟢 **Light Green**: Moderate vegetation (0.4 - 0.6)
- 🟢 **Dark Green**: Healthy dense vegetation (0.6 - 1.0)

#### Step 4: Receive Colorized Image

Sentinel Hub returns an **RGB PNG image** where each pixel's color represents the NDVI value at that location.

#### Step 5: Extract Average NDVI from Image

**Location**: `calculateAverageNDVI(imageBuffer)` (lines 1052-1171)

Since Sentinel Hub returns a colorized image, we need to **reverse-engineer** the NDVI values:

```javascript
// For RGB images (3 channels)
for (let i = 0; i < numPixels; i++) {
  const r = data[idx];     // Red channel
  const g = data[idx + 1]; // Green channel
  const b = data[idx + 2]; // Blue channel
  
  // Skip cloud/shadow/no-data pixels
  if (isCloudPixel(r, g, b)) continue;
  if (isShadowPixel(r, g, b)) continue;
  if (isNoDataPixel(r, g, b)) continue;
  if (isWaterPixel(r, g, b)) continue;
  
  // Estimate NDVI from RGB color
  let estimatedNDVI;
  if (r > 200 && g < 100) {
    // Red/Brown: NDVI 0.0-0.2
    estimatedNDVI = (1 - (r / 255.0)) * 0.2;
  } else if (r === 255 && b === 0) {
    // Yellow: NDVI 0.2-0.4
    estimatedNDVI = 0.2 + (g / 255.0) * 0.2;
  } else if (g > r && g > b) {
    // Green: NDVI 0.4-1.0
    const greenIntensity = g / 255.0;
    estimatedNDVI = 0.4 + greenIntensity * 0.6;
  } else {
    // Fallback
    estimatedNDVI = (g / 255.0) * 0.8 + 0.2;
  }
  
  pixels.push(Math.max(0, Math.min(1, estimatedNDVI)));
}

// Calculate average
const avgNDVI = pixels.reduce((a, b) => a + b, 0) / pixels.length;
```

#### Step 6: Final Average NDVI

The final average NDVI is calculated from all valid pixels:
- **Invalid pixels skipped**: Clouds, shadows, water, no-data
- **Valid pixels**: All vegetation and soil pixels
- **Result**: Average NDVI clamped to [0, 1] range

---

### 2. Planet Labs (Alternative Method)

#### Step 1: Request Analytic Asset

**Location**: `calculatePlanetLabsNDVI()` (lines 907-1037)

- Requests **analytic asset** (4-band image: Red, Green, Blue, NIR)
- Downloads the raw image buffer

#### Step 2: Extract Band Data

```javascript
const { data, info } = await sharp(analyticBuffer)
  .raw()
  .toBuffer({ resolveWithObject: true });

// Planet Labs analytic: 4 channels
// Band 0: Red
// Band 1: Green
// Band 2: Blue
// Band 3: NIR
```

#### Step 3: Calculate NDVI Per Pixel

```javascript
for (let i = 0; i < numPixels; i++) {
  const idx = i * info.channels;
  const red = data[idx];      // Band 0: Red
  const nir = data[idx + 3];  // Band 3: NIR
  
  // Direct NDVI calculation
  const denominator = nir + red;
  if (denominator > 0) {
    const ndvi = (nir - red) / denominator;
    ndviValues.push(Math.max(-1, Math.min(1, ndvi)));
  }
}
```

**Note**: Planet Labs provides raw band values, so we can calculate NDVI **directly** without color reverse-engineering.

#### Step 4: Calculate Average NDVI

```javascript
const sum = ndviValues.reduce((acc, val) => acc + val, 0);
const avgNDVI = sum / ndviValues.length;
return Math.max(0, Math.min(1, avgNDVI));  // Clamp to [0, 1]
```

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Requests Field Report                 │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│         Step 1: Get Field Geometry (Coordinates)              │
│         - Calculate bounding box from field polygon           │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│         Step 2: Choose Satellite Provider                    │
│         ├─ Sentinel Hub (Primary)                            │
│         └─ Planet Labs (Fallback)                            │
└───────────────────────┬───────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        ▼                               ▼
┌──────────────────┐          ┌──────────────────┐
│  Sentinel Hub    │          │  Planet Labs     │
│                  │          │                  │
│ 1. Request B04   │          │ 1. Request       │
│    (Red) & B08   │          │    Analytic     │
│    (NIR) bands   │          │    Asset         │
│                  │          │                  │
│ 2. Evalscript    │          │ 2. Download      │
│    calculates    │          │    Raw Bands     │
│    NDVI per      │          │                  │
│    pixel on      │          │ 3. Calculate     │
│    server        │          │    NDVI per      │
│                  │          │    pixel locally │
│ 3. Returns       │          │                  │
│    colorized     │          │ 4. Calculate     │
│    RGB image     │          │    average       │
│                  │          │                  │
└────────┬─────────┘          └────────┬─────────┘
         │                             │
         └─────────────┬───────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         Step 3: Extract Average NDVI                         │
│         - Skip clouds, shadows, water, no-data               │
│         - Calculate average from valid pixels                 │
│         - Clamp to [0, 1] range                              │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│         Step 4: Generate Health Score                        │
│         health_score = Math.round(avgNDVI * 100)            │
│         - NDVI 0.0 → Health Score 0                          │
│         - NDVI 0.5 → Health Score 50                        │
│         - NDVI 1.0 → Health Score 100                       │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│         Step 5: Store Results                                │
│         - Upload NDVI map image to Firebase Storage          │
│         - Save average_ndvi and health_score to Firestore   │
│         - Include in crop advisory report                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Technical Details

### 1. Cloud Masking
- **SCL (Scene Classification Layer)** identifies clouds, shadows, and no-data pixels
- **Cloud pixels** (SCL 8, 9, 10): Excluded from NDVI calculation
- **Shadow pixels** (SCL 3): Excluded from NDVI calculation
- **No-data pixels** (SCL 0, 1): Excluded from NDVI calculation

### 2. Data Validation
- **Red and NIR must be > 0**: Negative or zero values indicate invalid data
- **Denominator check**: Ensures `(NIR + Red) > 0` to avoid division by zero
- **Clamping**: NDVI values clamped to [-1, 1], then typically to [0, 1] for crops

### 3. Color Reverse-Engineering (Sentinel Hub)
Since Sentinel Hub returns a colorized image, the system uses **color estimation**:
- **Red/Brown pixels** → Low NDVI (0.0-0.2)
- **Yellow pixels** → Medium-low NDVI (0.2-0.4)
- **Green pixels** → Medium-high NDVI (0.4-1.0)

This is less accurate than direct calculation but necessary for visualization.

### 4. Direct Calculation (Planet Labs)
Planet Labs provides raw band values, allowing **direct NDVI calculation**:
```javascript
NDVI = (NIR - Red) / (NIR + Red)
```
This is more accurate than color reverse-engineering.

---

## Usage in Crop Advisory

### NDVI Thresholds for Decision Making

```javascript
const NDVI_THRESHOLD = 0.5;

if (ndvi < NDVI_THRESHOLD) {
  advisoryMode = 'no_crop';  // Field likely fallow
} else {
  advisoryMode = 'ask_current_crop';  // Active vegetation detected
}
```

### Health Score Calculation

```javascript
health_score = Math.round(avgNDVI * 100);
// Range: 0-100
// NDVI 0.0 → Score 0
// NDVI 0.5 → Score 50
// NDVI 1.0 → Score 100
```

---

## Summary

1. **NDVI Formula**: `(NIR - Red) / (NIR + Red)`
2. **Data Source**: Sentinel-2 satellite (B04=Red, B08=NIR) or Planet Labs
3. **Calculation**: Per-pixel, then averaged across the field
4. **Quality Control**: Cloud masking, shadow removal, invalid pixel filtering
5. **Output**: Average NDVI (0-1), Health Score (0-100), Colorized map image
6. **Usage**: Determines crop advisory mode (no_crop vs ask_current_crop)

The system provides accurate vegetation health assessment to help farmers make informed decisions about crop management.

