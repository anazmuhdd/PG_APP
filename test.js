import {
  useMultiFileAuthState,
  makeWASocket,
  DisconnectReason,
  Browsers,
} from "@whiskeysockets/baileys";
import axios from "axios";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import cron from "node-cron";

const PG_GROUP_JID = "120363404470997481@g.us";
const cateringServiceJID = "919847413782@s.whatsapp.net";
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
      console.log("presence: sent 'unavailable'");
    } catch (err) {
      console.warn(
        "presence: failed to send 'unavailable'",
        err?.message || err
      );
    }
  }

  function startHeartbeat(ms = 5 * 60 * 1000) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      sendUnavailableDebounced().catch((e) => {
        console.warn("presence heartbeat error:", e?.message || e);
      });
    }, ms);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  return {
    sendUnavailableDebounced,
    startHeartbeat,
    stopHeartbeat,
  };
}

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
    shouldSyncHistoryMessages: false,
  });

  const presenceCtrl = createPresenceController(sock);

  sock.ev.on(
    "connection.update",
    async ({
      connection,
      qr,
      lastDisconnect,
      receivedPendingNotifications,
    }) => {
      if (qr) {
        console.log("📲 Scan the QR Code (terminal):");
        qrcode.generate(qr, { small: true });

        try {
          const qrLink = await QRCode.toDataURL(qr);
          console.log("\n🌐 QR (data url) - open in browser to scan:");
          console.log(qrLink);
        } catch (err) {
          console.error("Failed to generate QR code link:", err);
        }
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;
        console.log("Disconnected. Reconnecting...", {
          code: lastDisconnect?.error?.output?.statusCode,
        });
        presenceCtrl.stopHeartbeat();
        if (shouldReconnect) {
          setTimeout(() => startSock(), 2000);
        }
      } else if (connection === "open") {
        console.log("✅ Connected to WhatsApp");
        try {
          await sock.sendPresenceUpdate("unavailable");
          presenceCtrl.startHeartbeat(5 * 60 * 1000); // every 5 minutes
          console.log(
            "presence: initial 'unavailable' sent and heartbeat started"
          );
        } catch (err) {
          console.warn("presence initial update failed:", err?.message || err);
        }
      }
    }
  );

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    const jid = msg.key.remoteJid;
    // if (jid !== PG_GROUP_JID || !msg.message || msg.key.fromMe) return;
    console.log("jid:", jid);
    const sender = msg.key.participantAlt || msg.key.participant;
    const member = PG_MEMBERS.find((m) => m.id === sender);
    const senderName = member ? member.name : "Unknown";
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text;

    console.log(`Received from ${senderName} (${sender}): ${text}`);
  });
}

// Start bot
startSock().catch(console.error);
