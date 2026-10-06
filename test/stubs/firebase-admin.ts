/**
 * Jest stand-in for firebase-admin (its ESM-only `jose` dependency cannot be
 * loaded by Jest's CommonJS runtime). The e2e suite runs without Firebase
 * credentials, so these are never called for real.
 */
const unavailable = () => {
  throw new Error('firebase-admin is stubbed in tests');
};
export const cert = unavailable;
export const initializeApp = unavailable;
export const getAuth = unavailable;
export const getMessaging = unavailable;
