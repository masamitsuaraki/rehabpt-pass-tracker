# RehabPT Pass Tracker

Internal admin tracker for HBOT monthly passes and SoftWave packages.

## Local Development

```bash
npm install
npm run dev
```

## Firebase Environment Variables

Create `.env.local` with:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

The app uses Firestore collections:

- `hbotPatients`
- `softwavePatients`
- `settings` with document `general`
