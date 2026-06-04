# Cambio Card Game (Multiplayer)

An interactive, real-time multiplayer version of the card game Cambio (also known as Cabo).
(bulit with coder11v, antigravity ide, and stitch by google.)
## Setup Instructions

Since you are hosting the frontend on GitHub Pages and want to keep your configuration out of the public repository, we will use a Cloudflare Worker to serve the Firebase configuration to your frontend. 

### 1. Firebase Setup
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your newly created project.
3. **Enable Anonymous Authentication:**
   - Go to **Build > Authentication**.
   - Click **Get Started**.
   - Go to the **Sign-in method** tab.
   - Click on **Anonymous**, enable it, and click Save.
4. **Enable Realtime Database:**
   - Go to **Build > Realtime Database**.
   - Click **Create Database**.
   - Choose your location and click Next.
   - Start in **Test Mode** (or if starting in Locked Mode, change the rules to):
     ```json
     {
       "rules": {
         ".read": "auth != null",
         ".write": "auth != null"
       }
     }
     ```
   - Click Enable.
5. **Get your Firebase Config:**
   - Go to Project Settings (the gear icon top left).
   - Scroll down to "Your apps". If you don't have a web app, click the `</>` icon to create one.
   - Copy the `firebaseConfig` object (you only need the keys/values, e.g., apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, databaseURL).

### 2. Cloudflare Worker Setup
We will put your Firebase config in a Cloudflare Worker, so your GitHub Pages frontend can fetch it securely without hardcoding it in the repo.

1. Log into your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Go to **Workers & Pages** -> **Overview** -> **Create Application** -> **Create Worker**.
3. Name it something like `cambio-config` and click **Deploy**.
4. Click **Edit code**.
5. Copy the contents of `worker/worker.js` from this repository and paste it into the Cloudflare editor.
6. Replace the placeholder values in the `FIREBASE_CONFIG` object in the Worker code with your actual Firebase config values.
7. Click **Save and deploy**.
8. Copy the URL of your deployed Worker (e.g., `https://cambio-config.your-username.workers.dev`).

### 3. Frontend Setup
1. Open `app.js` in this repository.
2. At the very top of `app.js`, replace the `WORKER_URL` string with the URL of your deployed Cloudflare Worker.
3. Push the code to your GitHub Pages branch!

## Game Rules
- 4 cards per player, face down.
- Bottom 2 cards can be viewed at the start of the game.
- Turn options: Draw from deck or discard pile.
- Powers (when drawing from deck and immediately discarding):
  - 7/8: Peek at one of your own cards.
  - 9/10: Peek at another player's card.
  - J/Q: Blind swap one of your cards with another player's card.
- Stacking: You can discard a card from your hand out of turn if it matches the top card of the discard pile. If you are wrong, you draw a penalty card face down.
- Call "Cambio" when you think you have the lowest score. Everyone else gets one final turn.
