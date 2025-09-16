const {
  useMultiFileAuthState,
  makeWASocket,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const axios = require("axios");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const cron = require("node-cron");

const PG_GROUP_JID = "120363404470997481@g.us";

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

// Track who has submitted orders
let todaysReplies = {};

function resetReplies() {
  todaysReplies = {};
  PG_MEMBERS.forEach((member) => {
    todaysReplies[member.id] = false;
  });
}

/**
 * Retry wrapper for axios requests
 * Retries on 500 errors (DB disconnect) with exponential backoff
 */
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
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });

  // QR & Connection
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
        console.log("Disconnected. Reconnecting...");
        if (shouldReconnect) startSock();
      } else if (connection === "open") {
        console.log("✅ Connected to WhatsApp");
      }
    }
  );

  sock.ev.on("creds.update", saveCreds);

  // Listen only to PG group messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    const jid = msg.key.remoteJid;
    if (jid !== PG_GROUP_JID || !msg.message || msg.key.fromMe) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const member = PG_MEMBERS.find((m) => m.id === sender);
    const senderName = member ? member.name : "Unknown";
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text;

    console.log(`Received from ${senderName} (${sender}): ${text}`);

    try {
      const today = new Date();
      const nextDay = new Date(today);
      nextDay.setDate(today.getDate() + 1);
      const dateString = nextDay.toISOString().split("T")[0];

      const res = await axiosRetryRequest({
        method: "POST",
        url: "https://pg-app-backend.onrender.com/process",
        data: {
          message: text,
          user_id: sender,
          user_name: senderName,
          date: dateString,
        },
      });

      const { reply, counter } = res.data;
      if (counter === 1) {
        todaysReplies[sender] = true;
        console.log(`✅ ${senderName} has submitted their order.`);
      }

      await sock.sendMessage(jid, { text: reply || "✅ Order received" });
    } catch (err) {
      console.error("Backend error (process):", err.message);
    }
  });

  // Keep Render app alive every 5 min
  cron.schedule("*/5 * * * *", async () => {
    try {
      await axiosRetryRequest({
        method: "GET",
        url: "https://pg-app-backend.onrender.com/ping",
      });
      console.log("🔄 Pinged backend to keep Render alive");
    } catch (err) {
      console.error("Ping failed:", err.message);
    }
  });

  // 9 PM trigger message
  cron.schedule("40 15 * * *", async () => {
    resetReplies();
    await sock.sendMessage(PG_GROUP_JID, {
      text: "📢 Good evening! Please submit your food order for tomorrow.",
    });
    console.log("✅ Sent 9 PM reminder to PG group");

    // Start dynamic reminders loop
    dynamicReminder(sock);
  });

  // 10 AM daily order summary
  cron.schedule("30 4 * * *", async () => {
    try {
      const today = new Date();
      const dateString = today.toISOString().split("T")[0];

      const res = await axiosRetryRequest({
        method: "GET",
        url: `https://pg-app-backend.onrender.com/detailed_summary?date=${dateString}`,
      });

      const orders = res.data.orders; // [{username, breakfast, lunch, dinner}]
      console.log("Fetched today's orders:", orders);

      if (!orders || orders.length === 0) {
        await sock.sendMessage(PG_GROUP_JID, {
          text: "📊 No orders found for today yet.",
        });
        return;
      }

      let summary = "📊 *Today's Orders Summary*:\n\n";
      for (const o of orders) {
        let meals = [];
        if (o.breakfast) meals.push("🍳 Breakfast");
        if (o.lunch) meals.push("🍛 Lunch");
        if (o.dinner) meals.push("🍽️ Dinner");
        summary += `✅ ${o.username}: ${meals.join(", ") || "No meals"}\n`;
      }

      await sock.sendMessage(PG_GROUP_JID, { text: summary });
      console.log("✅ Sent 10 AM summary to group");
    } catch (err) {
      console.error("Summary fetch failed:", err.message);
    }
  });
}

// Dynamic reminders every 15 min, checking DB
async function dynamicReminder(sock) {
  const interval = 30 * 60 * 1000; // 15 minutes

  const checkReplies = async () => {
    try {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();
      const istHour = (utcHour + 5 + Math.floor((utcMinute + 30) / 60)) % 24;
      console.log(`IST Hour: ${istHour}`);
      const currentHour = istHour;
      console.log(`Checking for missing orders at ${now.toLocaleTimeString()}`);

      // Skip reminders between 1 AM and 6 AM
      if (currentHour >= 1 && currentHour < 6) {
        console.log("😴 Sleeping hours (1 AM - 6 AM). Skipping reminders.");
        setTimeout(checkReplies, interval);
        return;
      }

      // Decide whether to check today's or tomorrow's orders
      let targetDate = new Date();
      if (currentHour >= 21) {
        // After 9 PM → check tomorrow
        targetDate.setDate(targetDate.getDate() + 1);
        console.log("🌙 After 9 PM → Checking tomorrow's orders");
      } else if (currentHour >= 6) {
        // Between 6 AM and 9 PM → check today
        console.log("🌞 Between 6 AM - 9 PM → Checking today's orders");
      } else {
        // Midnight - 1 AM edge case → still today
        console.log("🌃 Midnight - 1 AM → Checking today's orders");
      }

      const dateString = targetDate.toISOString().split("T")[0];

      const res = await axiosRetryRequest({
        method: "GET",
        url: `https://pg-app-backend.onrender.com/missing_orders?date=${dateString}`,
      });

      const missing = res.data.missing_users || [];
      console.log(
        `Checked for missing orders (${dateString}). ${missing.length} pending.`
      );

      if (missing.length === 0) {
        console.log("✅ All members replied. Waiting for next interval.");
        setTimeout(checkReplies, interval);
        return;
      }

      for (let m of missing) {
        await sock.sendMessage(m.whatsapp_id, {
          text: `⚠️ ${m.username}, you haven't submitted your food order yet. Please reply in the PG group.`,
        });
        console.log(`⚠️ Reminder sent to ${m.username} (${m.whatsapp_id})`);
      }
    } catch (err) {
      console.error("❌ Dynamic reminder fetch failed:", err.message);
    }

    // Schedule next check
    setTimeout(checkReplies, interval);
  };
  // Start the first check
  setTimeout(checkReplies, 0);
}

// Start WhatsApp bot
startSock().catch(console.error);
