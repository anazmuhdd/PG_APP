// bot.js
import {
  useMultiFileAuthState,
  makeWASocket,
  DisconnectReason,
  Browsers,
  generateWAMessageFromContent,
} from "@whiskeysockets/baileys";
import axios from "axios";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import cron from "node-cron";
import nodemailer from "nodemailer";

// ===== CONFIG =====
const PG_GROUP_JID = "120363404470997481@g.us";
const cateringServiceJID = "919847413782@s.whatsapp.net";

// 👇 YOUR FRIEND'S JID (replace with your actual WhatsApp number in JID format)
const FRIEND_JID = "917306256667@s.whatsapp.net"; // e.g., "919876543210@s.whatsapp.net"

const PG_MEMBERS = [
  { id: "919074211782@s.whatsapp.net", name: "Akash" },
  { id: "919645829304@s.whatsapp.net", name: "Akhinesh" },
  { id: "919188775142@s.whatsapp.net", name: "Alvin" },
  { id: "917306731189@s.whatsapp.net", name: "Amal" },
  { id: "919207066956@s.whatsapp.net", name: "Kasi" },
  { id: "916238007254@s.whatsapp.net", name: "Kurian" },
  { id: "919188712388@s.whatsapp.net", name: "Nihal" },
  { id: "919207605231@s.whatsapp.net", name: "Nikhil" },
];

// ===== EMAIL SETUP =====
const EMAIL_TRANSPORTER = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: "anazmohammed4games@gmail.com",      
    pass: "kgypohjdqwapyceu",             
  },
});

async function sendAlertEmail(originalMsg, replyMsgId) {
  await EMAIL_TRANSPORTER.sendMail({
    from: 'anazmohammed4games@gmail.com',
    to: "anasmonar@gmail.com",
    subject: "❗ Auto-Reply Not Seen – Follow Up Needed",
    text: `Your friend sent: "${originalMsg}"\n\nYour auto-reply (ID: ${replyMsgId}) was not seen within 2 hours.\nPlease call or check manually.`,
  });
}

// ===== UTILS =====
async function axiosRetryRequest(config, retries = 3, delay = 1000) {
  try {
    return await axios(config);
  } catch (err) {
    if (err.response?.status === 500 && retries > 0) {
      console.warn(`⚠️ Server 500 error. Retrying ${config.url}...`);
      await new Promise((r) => setTimeout(r, delay));
      return axiosRetryRequest(config, retries - 1, delay * 2); 
    }
    throw err;
  }
}

function createPresenceController(sock) {
  let lastPresenceAt = 0;
  const debounceMs = 30 * 1000;
  let heartbeatInterval = null;

  async function sendUnavailableDebounced() {
    const now = Date.now();
    if (now - lastPresenceAt < debounceMs) return;
    lastPresenceAt = now;
    try {
      await sock.sendPresenceUpdate("unavailable");
    } catch (err) {
      console.warn("presence update failed:", err?.message || err);
    }
  }

  function startHeartbeat(ms = 5 * 60 * 1000) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      sendUnavailableDebounced().catch(console.warn);
    }, ms);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  }

  return { startHeartbeat, stopHeartbeat };
}

// ===== MAIN BOT =====
const pendingReplyTimeouts = new Map();

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: Browsers.macOS("WhatsApp Bot"),
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
    shouldSyncHistoryMessage: () => false,
  });

  const presenceCtrl = createPresenceController(sock);

  // ===== HANDLE CONNECTION =====
  sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log("📲 Scan QR:");
      qrcode.generate(qr, { small: true });
      try {
        console.log("\n🌐 QR Link:", await QRCode.toDataURL(qr));
      } catch (err) {
        console.error("QR link error:", err);
      }
    }

    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Disconnected. Reconnecting...", { shouldReconnect });
      presenceCtrl.stopHeartbeat();
      if (shouldReconnect) {
        setTimeout(() => startSock(), 2000);
      }
    } else if (connection === "open") {
      console.log("✅ Connected");
      await sock.sendPresenceUpdate("unavailable");
      presenceCtrl.startHeartbeat();
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // ===== HANDLE INCOMING MESSAGES =====
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

    // Only respond to your friend and ignore your own messages
    if (sender !== FRIEND_JID || msg.key.fromMe || !text) return;

    console.log(`📩 From friend: ${text}`);

    // Wait 5 seconds before replying
    await new Promise((r) => setTimeout(r, 5000));

    // Auto-reply with the same message
    const replyMsg = generateWAMessageFromContent(
      jid,
      { conversation: text },
      { userJid: sock.user.id }
    );

    await sock.relayMessage(jid, replyMsg.message, { messageId: replyMsg.key.id });
    const replyId = replyMsg.key.id;
    console.log(`📤 Auto-replied (ID: ${replyId})`);
    // Set 2-min timeout to check if seen
    const twoHours = 1 * 60 * 1000;
    const timeout = setTimeout(async () => {
      if (pendingReplyTimeouts.has(replyId))
      {
        console.warn(`❗ Reply ${replyId} not seen in 2 mins. Sending email...`);
        await sendAlertEmail(text, replyId);
        pendingReplyTimeouts.delete(replyId);
      }
      else
      {
        return;
      }
    }, twoHours);
    pendingReplyTimeouts.set(replyId, timeout);
    console.log("prendinf reply: ",pendingReplyTimeouts)
  });

  // ===== TRACK MESSAGE READ STATUS =====
  sock.ev.on("messages.update", (updates) => {
    for (const update of updates) {
      console.log(update);
      const id=update.key.id
      const status=update.update.status;
      if (pendingReplyTimeouts.has(id) && status == 4) {
        console.log(`✅ Reply ${id} seen by friend.`);
        const timer = pendingReplyTimeouts.get(id);
        if (timer) clearTimeout(timer);
        pendingReplyTimeouts.delete(id);
      }
    }
  });

  return sock;
}

// Start the bot
startSock().catch(console.error);

/*
{
  key: {
    remoteJid: '918075869707@s.whatsapp.net',
    id: 'AC80EFEB02350ECF4D58BDD21DD17CD0',
    fromMe: false,
    participant: undefined
  },
  update: { status: 4 }
}
{
  key: {
    remoteJid: '918075869707@s.whatsapp.net',
    id: 'AC4FAAC8D08A98B74D781ED675CA976F',
    fromMe: false,
    participant: undefined
  },
  update: { status: 4 }
}
{
  key: {
    remoteJid: '918075869707@s.whatsapp.net',
    id: '3A7B1230DAC850F36B2A',
    fromMe: true,
    participant: undefined
  },
  update: { status: 3 }
*/