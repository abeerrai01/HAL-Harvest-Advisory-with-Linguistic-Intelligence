# HAL - Farmer Assistant Monorepo

This repository contains both the **backend** (Node.js API + WebSockets + worker) and the **frontend** (React Native / Expo app).

## Project Structure

```text
├── backend/          # Node.js Express API, WebSockets & background worker
├── frontend/         # React Native (Expo SDK 57) mobile and web app
└── .gitignore        # Root gitignore protecting secrets and dependencies
```

---

## Getting Started

### 1. Backend Setup

```bash
cd backend
npm install
```

Make sure your Firebase service account key is in the `backend/` folder:
- `backend/serviceAccountKey.json`

Start the backend server (runs on `http://localhost:5050`):
```bash
npm start
```

---

### 2. Frontend Setup

In a new terminal:
```bash
cd frontend
npm install
```

Configure your backend URL in `frontend/.env` (optional, defaults to `http://localhost:5050`):
```env
EXPO_PUBLIC_HAL_API_URL=http://localhost:5050
```

Start the Expo development server:
```bash
# For Web
npm run web

# For Mobile (Expo Go on iOS/Android)
npx expo start -c
```
