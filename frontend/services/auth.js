import { auth, db } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function registerUser({ fullName, email, phone, password }) {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  if (fullName) {
    await updateProfile(user, { displayName: fullName });
  }

  const userDocRef = doc(db, 'users', user.uid);
  let language = 'en';
  try {
    const stored = await AsyncStorage.getItem('hal_language');
    if (stored) language = stored;
  } catch (_) {}
  await setDoc(userDocRef, {
    uid: user.uid,
    fullName,
    email,
    phone,
    language,
    createdAt: Date.now(),
  });

  return user;
}

export async function signInUser({ email, password }) {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return user;
}

export async function fetchUserProfile(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function updateUserProfile(uid, updates) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, updates, { merge: true });
  if (updates.fullName) {
    await updateProfile(auth.currentUser, { displayName: updates.fullName });
  }
}


