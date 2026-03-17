// Firebase initialization and anonymous auth
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, initializeAuth, indexedDBLocalPersistence, signInAnonymously, Auth, User, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, Database, goOffline as fbGoOffline, goOnline as fbGoOnline } from 'firebase/database';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;
let currentUser: User | null = null;
let initPromise: Promise<User> | null = null;

export function isFirebaseConfigured(): boolean {
  return firebaseConfig.apiKey !== '' && firebaseConfig.databaseURL !== '';
}

const FIREBASE_AUTH_TIMEOUT_MS = 15_000;

export function initFirebase(): Promise<User> {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    if (!isFirebaseConfigured()) {
      reject(new Error('Firebase not configured — fill in firebaseConfig in FirebaseService.ts'));
      return;
    }

    app = initializeApp(firebaseConfig);
    // getAuth() registers a browserPopupRedirectResolver that hangs in
    // iOS WKWebView. Use initializeAuth with indexedDB persistence instead.
    auth = Capacitor.isNativePlatform()
      ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
      : getAuth(app);
    db = getDatabase(app);

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.error('[Firebase] Auth timed out after', FIREBASE_AUTH_TIMEOUT_MS, 'ms');
        initPromise = null; // allow retry
        reject(new Error('Connection timed out — check your network'));
      }
    }, FIREBASE_AUTH_TIMEOUT_MS);

    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      // Resolve on first successful auth state if signInAnonymously hasn't settled yet
      if (user && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(user);
      }
    });

    signInAnonymously(auth)
      .then((cred) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          currentUser = cred.user;
          resolve(cred.user);
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          console.error('[Firebase] Auth failed:', err.code, err.message);
          initPromise = null; // allow retry
          reject(err);
        }
      });
  });

  return initPromise;
}

export function getDb(): Database {
  if (!db) throw new Error('Firebase not initialized');
  return db;
}

export function getUser(): User | null {
  return currentUser;
}

export function getUserId(): string {
  if (!currentUser) throw new Error('Not authenticated');
  return currentUser.uid;
}

/** Re-authenticate anonymously (e.g. after token refresh failure). */
export async function reauth(): Promise<User | null> {
  if (!auth) return null;
  try {
    const cred = await signInAnonymously(auth);
    currentUser = cred.user;
    return cred.user;
  } catch {
    return null;
  }
}

/** Disconnect Firebase RTDB (call on app background/pause). */
export function goOffline(): void {
  if (db) fbGoOffline(db);
}

/** Reconnect Firebase RTDB (call on app resume/foreground). */
export function goOnline(): void {
  if (db) fbGoOnline(db);
}
