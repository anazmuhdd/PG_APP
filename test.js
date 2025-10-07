import {
  useMultiFileAuthState,
  makeWASocket,
  DisconnectReason,
  Browsers,
  isPnUser,
} from "@whiskeysockets/baileys";

import axios from "axios";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";

const PG_GROUP_JID = "120363404470997481@g.us";

// Retry wrapper
async function axiosRetryRequest(config, retries = 3, delay = 1000) {
  try {
    return await axios(config);
  } catch (err) {
    if (err.response && err.response.status === 500 && retries > 0) {
      console.warn(
        `⚠️ Server 500 error. Retrying ${config.url} in ${delay}ms...`
      );
      await new Promise((r) => setTimeout(r, delay));
      return axiosRetryRequest(config, retries - 1, delay * 2);
    }
    throw err;
  }
}

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: Browsers.windows("WhatsApp Bot"),
    shouldSyncHistoryMessages: false,
  });

  // Ensure auth state supports LID mapping (required in v7)
  // useMultiFileAuthState already handles this if you're on latest Baileys

  sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log("📲 Scan the QR Code (terminal):");
      qrcode.generate(qr, { small: true });

      try {
        const qrLink = await QRCode.toDataURL(qr);
        console.log("\n🌐 Open this QR in browser:");
        console.log(qrLink);
      } catch (err) {
        console.error("Failed to generate QR code link:", err);
      }
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Disconnected. Reconnecting...");
      if (shouldReconnect) startSock();
    } else if (connection === "open") {
      console.log("✅ Connected to WhatsApp");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    // === Extract ALL available IDs for debugging ===
    const {
      remoteJid,      // Main chat JID (group or user)
      participant,    // Sender in group context
      remoteJidAlt,   // Alternate for DMs (PN if remoteJid is LID, or vice versa)
      participantAlt, // Alternate for groups (PN if participant is LID)
    } = msg.key;

    console.log("\n🔍 Message ID Debug Info:");
    console.log("remoteJid     :", remoteJid);
    console.log("remoteJidAlt  :", remoteJidAlt);
    console.log("participant   :", participant);
    console.log("participantAlt:", participantAlt);

    // === Determine if it's a group or DM ===
    const isGroup = remoteJid.endsWith("@g.us");
    let userId; // <-- This will be the canonical user ID

    if (isGroup) {
      userId = participant; // This is the sender's ID (LID or PN)
    } else {
      userId = remoteJid; // In DMs, the chat JID is the user's ID
    }
    let phoneNumber;
    try {
      phoneNumber = isPnUser(userId) ? userId : null;
    } catch (e) {
      console.warn("Could not fetch phone number:", e.message);
    }
    // === Get phone number if available (for logging or legacy use) ===
    // === Get user name (you'll need to fetch contact or use group metadata) ===
    let senderName = "Unknown";
    try {
      if (isGroup) {
        const groupMeta = await sock.groupMetadata(remoteJid);
        const participantInfo = groupMeta.participants.find(p => p.id === userId);
        senderName = participantInfo?.name || "Unknown";
      } else {
        // For DMs, you can try to get contact
        const contact = await sock.contacts?.[userId];
        senderName = contact?.name || "Unknown";
      }
    } catch (e) {
      console.warn("Could not fetch sender name:", e.message);
    }

    // === Extract message text ===
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "[Non-text message]";

    console.log(`📩 From: ${senderName} | ID: ${userId} | Phone: ${phoneNumber || 'N/A'} | Group: ${isGroup ? remoteJid : 'DM'}`);
    console.log(`💬 Text: ${text}`);
  });
}

startSock();