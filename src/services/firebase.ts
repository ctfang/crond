import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Firebase is used only to obtain a Google identity token. Go owns app data and sessions.
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
