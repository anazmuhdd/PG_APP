const {
  useMultiFileAuthState,
  makeWASocket,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");

async function getGroupJID() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

  const sock = makeWASocket({ auth: state });

  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log("Scan QR to login:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      console.log("✅ Connected to WhatsApp");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log("Disconnected. Reconnecting...");
      if (shouldReconnect) {
        getGroupJID();
      }
    } else if (connection === "open") {
      console.log("✅ Connected to WhatsApp");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // Listen for all groups and log their IDs
  sock.ev.on("groups.update", (groups) => {
    console.log("Group info:", groups);
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.remoteJid.endsWith("@g.us")) return; // Only groups
    const groupJid = msg.key.remoteJid;
    const groupName = msg.pushName || "Unknown";
    console.log(`Group name: ${groupName}, JID: ${groupJid}`);
  });
}

getGroupJID();
