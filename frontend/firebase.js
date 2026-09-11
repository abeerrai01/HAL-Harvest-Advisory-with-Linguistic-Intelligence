// Firebase initialization and exports
import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Firebase config provided by user
const firebaseConfig = {
  apiKey: 'AIzaSyDYUoYWaElMMt9FQ_qJXU9V0vE3Zx_InwM',
  authDomain: 'hal-app-41b87.firebaseapp.com',
  projectId: 'hal-app-41b87',
  storageBucket: 'hal-app-41b87.firebasestorage.app',
  messagingSenderId: '2562078419',
  appId: '1:2562078419:web:cddb14cf82eba29ef2c626',
  measurementId: 'G-1K453L7NWC',
};

const app = initializeApp(firebaseConfig);

// React Native auth persistence with AsyncStorage
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);

export default app;


