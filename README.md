# Payment Notifier

A real-time UPI payment notification system for shops. When a UPI payment SMS arrives on your Android phone, an overlay notification pops up on your Windows PC instantly.

## How It Works

```
Android Phone (UPI SMS)
        ↓
SMS Forwarding App
        ↓
Firebase Realtime Database
        ↓
Local Server (Node.js)
        ↓
Electron Overlay (Windows desktop notification)
```

## Project Structure

```
payment_notifier_local_server_files/
├── package/
│   └── local_server_file/
│       ├── server.js          ← Main server (Firebase listener + Socket.IO)
│       ├── dashboard.html     ← Local web dashboard (logs + pause/resume)
│       ├── package.json
│       ├── .env               ← Your credentials (not in git)
│       └── .env.example       ← Template for .env
├── electron_app/
│   ├── main.js                ← Electron entry point
│   ├── preload.js             ← Socket.IO bridge (secure context)
│   ├── overlay.html           ← Notification UI
│   └── package.json
├── install.bat                ← Run once on a new computer
├── start.bat                  ← Run every day to launch everything
└── start-silent.vbs           ← Silent launcher (for auto-start on boot)
```

## First Time Setup

### 1. Firebase Setup

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project
3. Enable **Realtime Database** → create in test mode
4. Go to **Project Settings → Service Accounts → Generate new private key**
5. Set database rules:
```json
{
  "rules": {
    "payments": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

### 2. Configure `.env`

Copy `.env.example` to `.env` inside `package/local_server_file/` and fill in your values from the downloaded service account JSON:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=...
FIREBASE_CLIENT_ID=...
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_CERT_URL=...
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.region.firebasedatabase.app/
TOGGLE_SECRET=your-secret-here
UPDATE_URL=
```

### 3. Android SMS Forwarding

Install an SMS forwarding app on your Android phone that writes to Firebase Realtime Database. The app must write entries under the `payments` node in this format:

```json
{
  "payments": {
    "<auto-key>": {
      "sender": "VM-SBIBNK",
      "message": "Rs.500 credited to your account..."
    }
  }
}
```

### 4. Install Dependencies

Install [Node.js LTS](https://nodejs.org) then double-click:

```
install.bat
```

### 5. Run

```
start.bat
```

This opens the server in a terminal window and launches the overlay. The dashboard is available at [http://localhost:3000](http://localhost:3000).

## Auto-Start on Boot

To launch automatically when the PC turns on:

1. Press `Win + R` → type `shell:startup` → press Enter
2. Right-click inside the folder → **New → Shortcut**
3. Point it to `start-silent.vbs` in this folder

## Daily Use

Just double-click **`start.bat`**. Both the server and overlay start automatically.

To pause/resume payment listening, open [http://localhost:3000](http://localhost:3000) and click **Pause / Resume**.

## Setting Up on a New Computer

1. Install [Node.js LTS](https://nodejs.org)
2. `git clone https://github.com/subbu-h21/payment_notifier_local_server_files.git`
3. Create `.env` in `package/local_server_file/` (copy from `.env.example`)
4. Double-click `install.bat`
5. Double-click `start.bat`

## Ports Used

| Port | Purpose |
|------|---------|
| 3000 | Dashboard (HTTP) |
| 3001 | Dashboard log stream (WebSocket) |
| 5000 | Overlay notifications (Socket.IO) |
| 5001 | UDP beacon (local network discovery) |
