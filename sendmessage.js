import {
  useMultiFileAuthState,
  makeWASocket,
  Browsers,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";

const RECIPIENT = "918075869707@s.whatsapp.net";

const MESSAGES = [
  "Eneeh block aaaku. please"
];

const MESSAGE_DELAY = 1000 * 2;

function createPresenceController(sock) {
  let lastPresenceAt = 0;
  const debounceMs = 30 * 1000;
  let heartbeatInterval = null;

  async function sendUnavailableDebounced() {
    const now = Date.now();
    if (now - lastPresenceAt < debounceMs) {
      return;
    }
    lastPresenceAt = now;
    try {
      await sock.sendPresenceUpdate("unavailable");
    } catch (err) {
      console.warn("Failed to send presence update:", err?.message || err);
    }
  }

  function startHeartbeat(ms = 5 * 60 * 1000) {
    stopHeartbeat();
    heartbeatInterval = setInterval(sendUnavailableDebounced, ms);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  return { startHeartbeat, stopHeartbeat };
}

async function sendUnlimitedMessages() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(
      "auth_info_baileys"
    );

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      browser: Browsers.macOS("WhatsApp Bot"),
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
      shouldSyncHistoryMessage: () => false,
      logger: pino({
        level: "silent",
      }),
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
          console.log("❌ Disconnected. Reconnecting...", {
            code: lastDisconnect?.error?.output?.statusCode,
          });
          presenceCtrl.stopHeartbeat();
          if (shouldReconnect) {
            setTimeout(() => sendUnlimitedMessages(), 2000);
          }
        } else if (connection === "open") {
          console.log("✅ Connected to WhatsApp");
          try {
            await sock.sendPresenceUpdate("unavailable");
            presenceCtrl.startHeartbeat(5 * 60 * 1000);
          } catch (err) {
            console.warn("Presence update failed:", err?.message || err);
          }
        }
      }
    );

    sock.ev.on("creds.update", saveCreds);

    // Wait for connection to be open
    await new Promise((resolve) => {
      sock.ev.on("connection.update", ({ connection }) => {
        if (connection === "open") {
          console.log("✅ Connected to WhatsApp");
          resolve();
        }
      });
    });

    let jid = RECIPIENT.trim();
    if (!jid.includes("@")) {
      jid = `${jid}@s.whatsapp.net`;
    }

    const message = MESSAGES[0];
    console.log(`\n📤 Sending message repeatedly to: ${jid}\n`);

    let messageCount = 0;
    while (true) {
      try {
        await sock.sendMessage(jid, { text: message });
        messageCount++;
        console.log(`✅ [${messageCount}] Message sent: "${message}"`);

        await new Promise((resolve) => setTimeout(resolve, MESSAGE_DELAY));
      } catch (err) {
        console.error(`❌ Failed to send message: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, MESSAGE_DELAY));
      }
    }
  } catch (err) {
    console.error("❌ Fatal error:", err);
    process.exit(1);
  }
}

sendUnlimitedMessages().catch(console.error);