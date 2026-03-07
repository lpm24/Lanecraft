// Firebase initialization and anonymous auth
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, Auth, User, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, Database } from 'firebase/database';

// TODO: Replace with your actual Firebase config
const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  databaseURL: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
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
      .catch(reject);
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
