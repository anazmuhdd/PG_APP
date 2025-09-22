const {
  useMultiFileAuthState,
  makeWASocket,
  DisconnectReason,
  Browsers,
} = require("@whiskeysockets/baileys");
const axios = require("axios");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");

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

  // QR & connection
  sock.ev.on(
    "connection.update",
    async ({ connection, qr, lastDisconnect }) => {
      if (qr) {
        console.log("📲 Scan the QR Code (terminal):");
        qrcode.generate(qr, { small: true });

        try {
          const qrLink = await QRCode.toDataURL(qr);
          console.log("\n🌐 Open this QR in browser (scan from phone):");
          console.log(qrLink);
        } catch (err) {
          console.error("Failed to generate QR code link:", err);
        }
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;
        console.log("❌ Disconnected. Reconnecting...");
        if (shouldReconnect) startSock();
      } else if (connection === "open") {
        console.log("✅ Connected to WhatsApp");

        // ---- TEST CODE: Fetch missing orders + send mentions ----
        try {
          const today = new Date();
          const dateString = "2025-09-23";
          const day = today.toLocaleDateString("en-US", { weekday: "long" });

          const res = await axiosRetryRequest({
            method: "GET",
            url: `https://pg-app-backend.onrender.com/missing_orders?date=${dateString}`,
          });

          const missing = res.data.missing_users || [];
          console.log(
            `Checked for missing orders (${dateString}). ${missing.length} pending.`
          );

          if (missing.length === 0) {
            await sock.sendMessage(PG_GROUP_JID, {
              text: `✅ All members have already submitted their food orders for *${day}*!`,
            });
            return;
          }

          // Build mentions
          const mentions = missing.map((m) => m.whatsapp_id);
          const memberListString = missing
            .map(
              (m, i) =>
                `${i + 1}. @${m.whatsapp_id.split("@")[0]} (${m.username})`
            )
            .join("\n");

          await sock.sendMessage(PG_GROUP_JID, {
            text: `⚠️ The following members have not yet submitted their food orders for *${day}*:\n\n${memberListString}\n\nPlease submit your order ASAP!`,
            mentions: mentions,
          });

          console.log(
            `⚠️ Reminder sent to group for ${day} orders with mentions.`
          );
        } catch (err) {
          console.error("❌ Backend fetch/send failed:", err.message);
        }
      }
    }
  );

  sock.ev.on("creds.update", saveCreds);
}

startSock();
