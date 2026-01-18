# Personal-Fast-Tracker

## Code Quality Tools

This project uses several code quality tools to maintain high standards. See [CODE_QUALITY.md](CODE_QUALITY.md) for detailed information.

**Quick start:**
```bash
npm install
npm run check  # Run all code quality checks
```

## Firebase configuration

This app expects Firebase configuration to be provided in `firebase-config.js` and loaded before `script.js`.

1. Copy `firebase-config.js` and replace the placeholder values with the config from your Firebase project:
   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     projectId: "YOUR_PROJECT_ID",
     appId: "YOUR_APP_ID"
   };
   ```
2. For environment-specific values, keep different `firebase-config.js` files per environment (local, staging, prod) and swap them during deployment, or have your hosting pipeline inject the correct values.

## Firebase setup steps

1. **Create a Firebase project** in the Firebase console.
2. **Enable Authentication**: go to **Build → Authentication → Sign-in method** and enable **Email/Password**.
3. **Create Firestore**: go to **Build → Firestore Database** and create a database in your preferred region.
4. **(Optional) Create Realtime Database**: go to **Build → Realtime Database** if you plan to use it.
5. **Deploy security rules**:
   - Firestore rules are in `firestore.rules`.
   - Realtime Database rules are in `database.rules.json`.

   Using the Firebase CLI:
   ```bash
   firebase deploy --only firestore:rules
   firebase deploy --only database
   ```

## Data structure expectations

All user data is written beneath a `users/{uid}` path, matching the security rules. The app currently writes:

- `users/{uid}` (user metadata such as encryption salt)
- `users/{uid}/fastingState/state` (encrypted app state)

Ensure your rules continue to allow only the authenticated user (`request.auth.uid`) to read/write their own data.
