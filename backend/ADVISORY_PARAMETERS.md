# Advisory Parameters Sent to AI Prompt

This document lists all advisory parameters that are included in the AI recommendations prompt.

## 📋 Complete List of Advisory Parameters

### 1. **State** (`state`)
- **Value**: `'Uttarakhand'` (hardcoded)
- **Source**: Modal input (Step 1)
- **In Prompt**: Included in `STATE CONTEXT` section and advisor specialization
- **Usage**: Provides Uttarakhand-specific agricultural context

### 2. **District** (`district`)
- **Value**: Selected district from dropdown (e.g., `'dehradun'`, `'haridwar'`, `'nainital'`)
- **Source**: Modal input (Step 1)
- **In Prompt**: 
  - `STATE CONTEXT` section: `- Districts: Current district: ${district}`
  - `ADVISORY MODE` section: `- District: ${district}`
- **Usage**: District-specific crop recommendations and soil type context

### 3. **Soil Type** (`soil_type`)
- **Value**: Selected soil type based on district (e.g., `'Alluvial'`, `'Sandy Loam'`, `'Red to Dark'`)
- **Source**: Modal input (Step 1)
- **In Prompt**: 
  - `STATE CONTEXT` section: `- Soil Type: ${soil_type}`
  - `ADVISORY MODE` section: `- Soil Type: ${soil_type}`
- **Usage**: Soil-specific crop selection and fertilizer recommendations

### 4. **Season** (`season`)
- **Value**: Auto-detected season (`'Kharif'`, `'Rabi'`, or `'Zaid'`)
- **Source**: Auto-detected based on current date (Step 2)
- **In Prompt**: 
  - `STATE CONTEXT` section: `- Current Season: ${season}`
  - `ADVISORY MODE` section: `- Season: ${season}`
- **Usage**: Season-appropriate crop recommendations and timing

### 5. **Soil Health Method** (`soil_health_method`)
- **Value**: `'card'`, `'manual'`, or `'skip'`
- **Source**: Modal input (Step 3)
- **In Prompt**: Not directly in prompt, but affects what data is included
- **Usage**: Determines whether to use soil health card text or manual NPK values

### 6. **Manual NPK Values** (`manual_npk`)
- **Value**: Object with `{ nitrogen: string, phosphorus: string, potassium: string }`
- **Source**: Modal input (Step 3) - if user selects "Enter N, P, K Values"
- **In Prompt**: 
  ```
  MANUAL SOIL NUTRIENTS (User Provided):
  - Nitrogen (N): ${manual_npk.nitrogen}%
  - Phosphorus (P): ${manual_npk.phosphorus || 'N/A'}%
  - Potassium (K): ${manual_npk.potassium || 'N/A'}%
  ```
- **Usage**: Used for fertilizer recommendations when soil health card is not uploaded

### 7. **Soil Health Card Text** (`soil_health_card_text` / `soilHealthCardText`)
- **Value**: Extracted text from uploaded soil health card (OCR result)
- **Source**: Modal input (Step 3) - if user uploads soil health card
- **In Prompt**: 
  ```
  SOIL HEALTH CARD DATA (Extracted Text):
  ${soilHealthCardText}
  ```
- **Usage**: Provides actual soil parameters (pH, N, P, K, etc.) for precise recommendations

### 8. **Irrigation Days Ago** (`irrigation_days_ago`)
- **Value**: Number of days since last irrigation (e.g., `3`, `7`, `15`)
- **Source**: Modal input (Step 4)
- **In Prompt**: 
  - `ADVISORY MODE` section: 
    ```
    - Last Irrigation: ${irrigationDaysAgo} days ago (CRITICAL: Use this information to calculate optimal next irrigation timing, frequency, and amount. Consider crop water requirements, soil moisture retention, and weather forecast when recommending next irrigation.)
    ```
  - `MODE RULES` section: 
    ```
    including irrigation schedule (especially important: last irrigation was ${irrigationDaysAgo} days ago, calculate optimal next irrigation based on this)
    ```
  - `irrigation_plan` JSON structure: 
    ```json
    "last_irrigation_days_ago": ${irrigationDaysAgo || 'null'},
    "irrigation_status": "Irrigated ${irrigationDaysAgo} days ago. Based on this, provide optimal next irrigation timing and amount..."
    ```
  - `current_crop_advisory.irrigation.timing`: 
    ```
    "Based on last irrigation ${irrigationDaysAgo} days ago, calculate optimal next irrigation timing"
    ```
- **Usage**: **CRITICAL** - Calculates optimal next irrigation timing, frequency, and amount

## 📊 Additional Data in Prompt (Not from Modal)

### Field Data
- Field ID
- Location (Latitude, Longitude)
- Field Area (hectares)

### Soil Health (SoilGrids API)
- pH
- Clay percentage
- Sand percentage
- Silt percentage
- Soil Organic Carbon

### Satellite Data (NDVI)
- Average NDVI
- Health Score (0-100)
- Satellite Image Date
- Overall Health Status

### Weather Forecast
- 5-day weather forecast data

### Anomalies
- Detected anomalies in field

### Current Crop
- User-selected current crop (if provided)

## 🔄 Data Flow

1. **User fills modal** → Parameters stored in `advisory_params` object
2. **Job created** → `advisory_params` saved to AsyncStorage
3. **Report generated** → Report data fetched
4. **AI Recommendations called** → `advisory_params` loaded from AsyncStorage
5. **Backend receives** → Parameters extracted and included in prompt
6. **AI processes** → Generates recommendations using all parameters

## ✅ Summary

**Total Advisory Parameters from Modal: 8**
1. ✅ State
2. ✅ District
3. ✅ Soil Type
4. ✅ Season
5. ✅ Soil Health Method (indirect - determines which data to use)
6. ✅ Manual NPK Values (when manually entered)
7. ✅ Soil Health Card Text (when card uploaded)
8. ✅ Irrigation Days Ago (with strong emphasis)

All parameters are stored and passed correctly, with irrigation days receiving special emphasis in the prompt for optimal irrigation scheduling.

