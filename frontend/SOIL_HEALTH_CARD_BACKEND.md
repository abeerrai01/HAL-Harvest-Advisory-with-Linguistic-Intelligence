# Soil Health Card Upload - Backend API Requirements

## Overview
The frontend now supports uploading Soil Health Cards (images/PDFs) with OCR text extraction. The following backend endpoints need to be implemented.

## Required Backend Endpoints

### 1. Upload Soil Health Card
**Endpoint:** `POST /api/v1/soil-health-card/upload`

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Body:
  - `file`: File (image or PDF)
  - `farmer_ID`: string (optional)
  - `field_ID`: string (optional)

**Response:**
```json
{
  "success": true,
  "url": "https://cloudinary.com/...",
  "fileUrl": "https://cloudinary.com/...",
  "message": "File uploaded successfully"
}
```

**Implementation Notes:**
- Upload file to Cloudinary
- Return the Cloudinary URL
- Store metadata in database (optional)

### 2. Extract Text from Soil Health Card
**Endpoint:** `POST /api/v1/soil-health-card/extract`

**Request:**
```json
{
  "fileUrl": "https://cloudinary.com/...",
  "farmer_ID": "farmer-123",
  "field_ID": "field-456"
}
```

**Response:**
```json
{
  "success": true,
  "extractedText": "pH: 6.5, Nitrogen: 80%, Phosphorus: 60%, Potassium: 100%...",
  "text": "pH: 6.5, Nitrogen: 80%...",
  "confidence": 0.95
}
```

**Implementation Notes:**
- Use OCR service (Google Vision API, Tesseract, or similar)
- Extract text from image/PDF
- Return extracted text
- Store in database with fileUrl

### 3. Get Soil Health Card History
**Endpoint:** `GET /api/v1/soil-health-card/history`

**Query Parameters:**
- `farmer_ID`: string (required)
- `field_ID`: string (optional)
- `limit`: number (optional, default: 20)

**Response:**
```json
{
  "success": true,
  "items": [
    {
      "fileUrl": "https://cloudinary.com/...",
      "extractedText": "pH: 6.5...",
      "uploadedAt": "2025-11-23T10:00:00Z",
      "field_ID": "field-456",
      "farmer_ID": "farmer-123"
    }
  ]
}
```

## Integration with Existing APIs

### Soil Advisory API
**Endpoint:** `POST /api/v1/soil-advisory`

**Updated Request Body:**
```json
{
  "field_ID": "field-123",
  "farmer_ID": "farmer-456",
  "language": "en",
  "field_location": { "lat": 30.0, "lon": 78.0 },
  "extractedText": "pH: 6.5, Nitrogen: 80%...",  // NEW: Optional
  "hasSoilHealthCard": true  // NEW: Optional
}
```

**Implementation:**
- If `extractedText` is provided, use it to enhance soil analysis
- Parse extracted text to extract pH, NPK values, etc.
- Use parsed values in soil health calculation
- Include in AI prompt for better recommendations

### Crop Advisory API
**Endpoint:** `POST /api/v1/ai-recommendations`

**Updated Request Body:**
```json
{
  "reportData": {...},
  "farmer_ID": "farmer-123",
  "field_ID": "field-456",
  "language": "en",
  "current_crop": "Wheat",
  "extractedText": "pH: 6.5, Nitrogen: 80%...",  // NEW: Optional
  "hasSoilHealthCard": true  // NEW: Optional
}
```

**Implementation:**
- If `extractedText` is provided, include in AI prompt
- Use soil parameters from card for better crop recommendations
- Enhance recommendations with actual soil test data

## OCR Service Options

1. **Google Cloud Vision API** (Recommended)
   - High accuracy
   - Supports images and PDFs
   - Good for structured documents

2. **Tesseract OCR**
   - Open source
   - Good for images
   - May need preprocessing

3. **AWS Textract**
   - Good for structured documents
   - Supports tables and forms

## Cloudinary Configuration

Ensure Cloudinary is configured in your backend:
- `CLOUDINARY_URL` or individual credentials
- Upload to folder: `soil_health_cards/`
- Resource type: `auto` (handles images and PDFs)

## Database Schema

**Collection:** `soil_health_cards`

```javascript
{
  farmer_ID: string,
  field_ID: string,
  fileUrl: string,
  extractedText: string,
  uploadedAt: timestamp,
  fieldName: string,
  usedFor: 'soil_health' | 'crop_advisory',
  metadata: {
    pH: number,
    nitrogen: number,
    phosphorus: number,
    potassium: number,
    // ... other extracted values
  }
}
```

## Frontend Implementation Status

✅ API functions added to `services/halApi.js`
✅ Upload UI added to `screens/SoilHealth.jsx`
✅ Upload modal added to `screens/CropAdvisory1.jsx`
✅ Extracted text integration in soil health analysis
✅ Extracted text integration in crop advisory
✅ Firebase Firestore storage
✅ Cloudinary upload support

## Next Steps

1. Implement backend endpoints in `hal-api/src/server.js`
2. Add OCR service integration
3. Update soil advisory API to use extracted text
4. Update crop advisory API to use extracted text
5. Test end-to-end flow

