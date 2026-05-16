// ================= IMPORTS =================
const path = require("path");
const { readFileSync, appendFileSync } = require("fs");
const express = require("express");
const { Server } = require("socket.io");
const admin = require("firebase-admin");
const dgram = require("dgram");
const { WebSocketServer, WebSocket } = require("ws");
const crypto = require("crypto");

// ================= DOTENV =================
// In pkg builds, load .env from the folder containing the exe
const dotenv = require("dotenv");
const envPath = process.pkg
  ? path.join(path.dirname(process.execPath), ".env")
  : path.join(__dirname, ".env");
dotenv.config({ path: envPath });

// ================= LOG FILE =================
const LOG_PATH = process.pkg
  ? path.join(path.dirname(process.execPath), "server.log")
  : path.join(__dirname, "server.log");

// ================= CRASH HANDLER =================
process.on("uncaughtException", (err) => {
  const entry = `[CRASH] ${new Date().toISOString()} uncaughtException: ${err.stack || err.message}`;
  try { appendFileSync(LOG_PATH, entry + "\n"); } catch (_) {}
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const entry = `[CRASH] ${new Date().toISOString()} unhandledRejection: ${reason?.stack || reason}`;
  try { appendFileSync(LOG_PATH, entry + "\n"); } catch (_) {}
});

function writeLogFile(entry) {
  try { appendFileSync(LOG_PATH, entry + "\n"); } catch (_) {}
}

// ================= STATE =================
let isRunning = true;
let firebaseStatus = false;
const MAX_LOGS = 2000;
const logs = [];
let lastKey = null;
let paymentCallback = null;

// ================= LOG SYSTEM =================
function addLog(message) {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${message}`;
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  console.log(entry);
  writeLogFile(entry);
  broadcastLog(entry);
}

// ================= WEBSOCKET (DASHBOARD) =================
const wss = new WebSocketServer({ port: 3001 });

function broadcastLog(log) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(log);
    }
  });
}

// ================= EXPRESS (DASHBOARD) =================
const app = express();
app.use(express.json());

const TOGGLE_SECRET = process.env.TOGGLE_SECRET || "";

if (!TOGGLE_SECRET) {
  console.warn("WARNING: TOGGLE_SECRET is not set — /toggle endpoint is unprotected");
}

app.get("/", (req, res) => {
  const dashPath = process.pkg
    ? path.join(path.dirname(process.execPath), "dashboard.html")
    : path.join(__dirname, "dashboard.html");
  res.sendFile(dashPath);
});

app.post("/toggle", (req, res) => {
  if (TOGGLE_SECRET && req.headers["x-toggle-secret"] !== TOGGLE_SECRET) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  isRunning = !isRunning;

  if (isRunning) {
    addLog("Resumed listening");
    startListening();
  } else {
    addLog("Paused listening");
    stopListening();
  }

  res.sendStatus(200);
});

// ================= FIREBASE =================
const serviceAccount = {
  type: process.env.FIREBASE_TYPE || "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  // dotenv preserves \n in double-quoted values; replace just in case
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  universe_domain: "googleapis.com",
};

if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
  console.error("Firebase credentials missing. Check your .env file.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();
const paymentsRef = db.ref("payments");

// ================= SOCKET.IO =================
const io = new Server(5000, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  addLog(`Extension connected: ${socket.id}`);
  socket.on("disconnect", () =>
    addLog(`Extension disconnected: ${socket.id}`)
  );
});

// ================= BANK SENDERS =================
const BANK_SENDER_URL =
  "https://raw.githubusercontent.com/subbu-h21/paymentsound-config/main/bank_sender.json";

let bankSenders = new Set();

async function fetchBankSenders(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BANK_SENDER_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      bankSenders = new Set(json.senders);
      addLog(`Bank senders loaded (${bankSenders.size})`);
      return;
    } catch (err) {
      addLog(`Failed to fetch bank senders (attempt ${attempt}/${retries}): ${err.message}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }

  if (bankSenders.size === 0) {
    addLog("CRITICAL: No bank senders available — rejecting all payments until next refresh");
  }
}

function isValidSender(sender) {
  if (bankSenders.has(sender)) return true;
  // Match only if both the known sender and the incoming sender share the same
  // suffix after the last dash (e.g. "VM-SBIBNK" matches "BP-SBIBNK").
  // Anchored to the suffix to prevent "EVIL-SBIBNK-FAKE" spoofing.
  const senderDash = sender.lastIndexOf("-");
  if (senderDash === -1) return false;
  const senderCode = sender.slice(senderDash + 1);
  for (const valid of bankSenders) {
    const dashIdx = valid.lastIndexOf("-");
    if (dashIdx !== -1 && valid.slice(dashIdx + 1) === senderCode) return true;
  }
  return false;
}

// ================= AMOUNT EXTRACTION =================
const AMOUNT_PATTERNS = [
  /credited\s+for\s+Rs\.?\s*([\d,]+(?:\.\d+)?)/i,
  /INR\s*([\d,]+(?:\.\d+)?)\s+credited/i,
  /credited\s+by\s+Rs\.?\s*([\d,]+(?:\.\d+)?)/i,
  /Rs\.?\s*([\d,]+(?:\.\d+)?)\s+(?:has been\s+)?credited/i,
  /received\s+Rs\.?\s*([\d,]+(?:\.\d+)?)/i,
  /received\s+INR\s*([\d,]+(?:\.\d+)?)/i,
];

function extractAmount(message) {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = pattern.exec(message);
    if (match) return parseFloat(match[1].replace(/,/g, ""));
  }
  return null;
}

// ================= FIREBASE LISTENER =================
function startListening() {
  if (paymentCallback) return; // already attached

  paymentCallback = async (snapshot) => {
    if (!isRunning) return;

    if (lastKey && snapshot.key <= lastKey) return;

    const data = snapshot.val();
    const sender = data.sender || "";

    if (!isValidSender(sender)) {
      addLog(`Rejected sender: ${sender}`);
      await snapshot.ref.remove();
      return;
    }

    const smsText = data.message || "";
    const amount = extractAmount(smsText);

    if (amount === null) {
      addLog(`Unparseable message from ${sender}: ${smsText.slice(0, 80)}`);
      await snapshot.ref.remove();
      return;
    }

    const payload = { amount, raw_message: smsText };

    addLog(`Payment: ₹${amount}`);

    io.emit("new payment", payload);

    try {
      await snapshot.ref.remove();
    } catch (err) {
      addLog(`Delete failed: ${err.message}`);
    }
  };

  paymentsRef.on("child_added", paymentCallback);
}

function stopListening() {
  if (paymentCallback) {
    paymentsRef.off("child_added", paymentCallback);
    paymentCallback = null;
  }
}

// ================= AUTO-UPDATER =================
// Manifest JSON expected at UPDATE_URL: { "version": "1.2.0", "url": "https://...", "sha256": "abc123..." }
const pkg = require("./package.json");
const CURRENT_VERSION = pkg.version;

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const fs = require("fs");
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    const http = require("http");
    const fs = require("fs");
    const client = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);

    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", (err) => { fs.unlink(dest, () => {}); reject(err); });
    }).on("error", (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function checkForUpdate() {
  if (!process.pkg) return;
  const updateUrl = process.env.UPDATE_URL || "";
  if (!updateUrl) return;

  try {
    addLog("Checking for updates...");
    const res = await fetch(updateUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();

    if (compareVersions(manifest.version, CURRENT_VERSION) <= 0) {
      addLog(`Up to date (v${CURRENT_VERSION})`);
      return;
    }

    if (!manifest.sha256) {
      addLog("Update manifest missing sha256 — update rejected for safety");
      return;
    }

    addLog(`Update available: v${manifest.version} (current v${CURRENT_VERSION}). Downloading...`);

    const exeDir = path.dirname(process.execPath);
    const newExePath = path.join(exeDir, "ShopServer.new.exe");

    await downloadFile(manifest.url, newExePath);

    // Verify integrity before running anything
    const digest = await sha256File(newExePath);
    if (digest !== manifest.sha256) {
      const fs = require("fs");
      fs.unlinkSync(newExePath);
      addLog(`Update rejected: SHA256 mismatch (got ${digest}, expected ${manifest.sha256})`);
      return;
    }

    addLog("Download verified. Applying update and restarting...");

    const batPath = path.join(exeDir, "_update.bat");
    const bat = [
      "@echo off",
      "timeout /t 3 /nobreak > nul",
      `move /y "${newExePath}" "${process.execPath}"`,
      `start "" "${process.execPath}"`,
      `del "%~f0"`,
    ].join("\r\n");

    require("fs").writeFileSync(batPath, bat);

    const { spawn } = require("child_process");
    spawn("cmd.exe", ["/c", batPath], { detached: true, stdio: "ignore" }).unref();

    process.exit(0);
  } catch (err) {
    addLog(`Update check failed: ${err.message}`);
  }
}

// ================= OPEN BROWSER =================
function openBrowser(url) {
  const { spawn } = require("child_process");
  const commands = {
    win32: ["cmd.exe", ["/c", "start", "", url]],
    darwin: ["open", [url]],
    linux: ["xdg-open", [url]],
  };
  const entry = commands[process.platform];
  if (entry) {
    spawn(entry[0], entry[1], { detached: true, stdio: "ignore" }).unref();
  }
}

// ================= START DASHBOARD =================
const PORT = 3000;

app.listen(PORT, () => {
  addLog(`Dashboard running at http://localhost:${PORT}`);
  openBrowser(`http://localhost:${PORT}`);
});

// ================= UDP BROADCAST =================
const beaconSocket = dgram.createSocket("udp4");
beaconSocket.bind(() => {
  beaconSocket.setBroadcast(true);
  const msg = Buffer.from(
    JSON.stringify({ type: "payment-server", port: 5000 })
  );
  setInterval(() => {
    beaconSocket.send(msg, 0, msg.length, 5001, "255.255.255.255");
  }, 2000);
});

// ================= INIT =================
(async () => {
  await fetchBankSenders();
  setInterval(fetchBankSenders, 6 * 60 * 60 * 1000);

  checkForUpdate();
  setInterval(checkForUpdate, 6 * 60 * 60 * 1000);

  paymentsRef
    .orderByKey()
    .limitToLast(1)
    .once("value", (snapshot) => {
      snapshot.forEach((child) => {
        lastKey = child.key;
      });
      addLog("Server ready");
      firebaseStatus = true;
      startListening();
    });

  addLog("Firebase → WebSocket relay running on port 5000");
})();
