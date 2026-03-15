// Firebase initialization and anonymous auth
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, Auth, User, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, Database } from 'firebase/database';

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

export function initFirebase(): Promise<User> {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    if (!isFirebaseConfigured()) {
      reject(new Error('Firebase not configured — fill in firebaseConfig in FirebaseService.ts'));
      return;
    }

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);

    onAuthStateChanged(auth, (user) => {
      currentUser = user;
    });

    signInAnonymously(auth)
      .then((cred) => {
        currentUser = cred.user;
        resolve(cred.user);
      })
      .catch((err) => {
        console.error('[Firebase] Auth failed:', err.code, err.message);
        initPromise = null; // allow retry
        reject(err);
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
