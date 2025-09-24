const {
  useMultiFileAuthState,
  makeWASocket,
  DisconnectReason,
  Browsers,
} = require("@whiskeysockets/baileys");
const axios = require("axios");
const cron = require("node-cron");

// ===== CONFIG =====
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

// Your WhatsApp number (with country code, no + or spaces)
const YOUR_PHONE_NUMBER = "919778250566"; // ← REPLACE WITH YOUR NUMBER

// ===== UTILS =====
async function axiosRetryRequest(config, retries = 3, delay = 1000) {
  try {
    return await axios(config);
  } catch (err) {
    if (err.response && err.response.status === 500 && retries > 0) {
      console.warn(`⚠️ Server 500 error. Retrying ${config.url} in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      return axiosRetryRequest(config, retries - 1, delay * 2);
    }
    throw err;
  }
}

// ===== MAIN BOT =====
async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // Must be false for pairing code
    browser: Browsers.macOS("Desktop"), // ✅ Critical for multi-device
    markOnlineOnConnect: false,
    syncFullHistory: false,
    waitForChats: false,
    keepAliveIntervalMs: 30_000,
    connectTimeoutMs: 60_000,
    syncAppState: false,
    getMessage: async () => null,
    shouldSyncHistoryMessage: () => false,
    downloadHistory: false,
    syncContacts: false,
    emitOwnEvents: false,
    fireInitQueries: false,
    transactionOpts: { maxCommitRetries: 1, maxUncommittedTransactions: 1 },
  });

  sock.ev.on("creds.update", saveCreds);

  // ===== CONNECTION HANDLER =====
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Disconnected. Reconnecting...");
      if (shouldReconnect) {
        setTimeout(() => startSock(), 3000);
      } else {
        console.log("Session expired. Delete auth_info_baileys and restart.");
      }
    } else if (connection === "open") {
      console.log("✅ Connected to WhatsApp via pairing code!");

      // ✅ Fix: Set offline presence AFTER connection
      setTimeout(() => {
        if (sock.user?.id) {
          sock.sendPresenceUpdate("unavailable", sock.user.id);
          console.log("✅ Set offline presence to restore phone notifications");
        }
      }, 1000);
    }
  });

  // ===== FIRST-TIME: GENERATE PAIRING CODE =====
  if (!sock.authState.creds.registered) {
    console.log(`📱 Generating pairing code for ${YOUR_PHONE_NUMBER}...`);
    const code = await sock.requestPairingCode(YOUR_PHONE_NUMBER);
    console.log(`\n🔑 YOUR PAIRING CODE: ${code}\n`);
    console.log("👉 On your phone: WhatsApp → Settings → Linked Devices → Pair with code");
    return; // Stop here — wait for pairing
  }

  // ===== MESSAGE HANDLER (your existing logic) =====
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
      const res = await axiosRetryRequest({
        method: "POST",
        url: "https://pg-app-backend.onrender.com/process",
        data: {
          message: text,
          user_id: sender,
          user_name: senderName,
        },
      });

      const { reply, counter } = res.data;
      if (counter === 1) {
        console.log(`✅ ${senderName} has submitted their order.`);
      }

      await sock.sendMessage(jid, { text: reply || "✅ Order received" });
    } catch (err) {
      console.error("Backend error (process):", err.message);
    }
  });

  // ===== KEEP ALIVE & CRON JOBS (your existing logic) =====
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

  // Evening reminder
  cron.schedule("15 14 * * *", async () => {
    await sock.sendMessage(PG_GROUP_JID, {
      text: "📢 Good evening! Please submit your food order for tomorrow.\n\nFor breakfast please order before 9PM",
    });
    console.log("✅ Sent 7:30 PM reminder to PG group");
    dynamicReminder(sock);
  });

  // Breakfast summary (9:30 PM IST)
  cron.schedule("00 16 * * *", async () => {
    const now = new Date();
    const indiaOffsetMs = 5.5 * 60 * 60 * 1000;
    const indiaNow = new Date(now.getTime() + indiaOffsetMs);
    indiaNow.setDate(indiaNow.getDate() + 1);
    const indiaTomorrow = indiaNow.toISOString().split("T")[0];

    try {
      const res = await axiosRetryRequest({
        method: "GET",
        url: `https://pg-app-backend.onrender.com/detailed_summary?date=${indiaTomorrow}`,
      });
      const orders = res.data.orders;
      if (!orders || orders.length === 0 || res.data.total_orders === 0) return;

      const breakfastOrders = orders.filter((o) => o.breakfast);
      const breakfastNames = breakfastOrders.map((o) => o.username);
      const breakfastCount = breakfastOrders.length;

      const breakfastSummaryMsg = `🍳 *Breakfast Orders for Tomorrow*\n\n${
        breakfastNames.length > 0
          ? breakfastNames.map((n, i) => `${i + 1}. ${n}`).join("\n")
          : "No orders yet."
      }\n\nNo more orders can be placed for breakfast now.`;

      const malayalamMsg = `ചേച്ചി, \n\nനാളെ (${indiaTomorrow}),\n${breakfastCount} പേർക്ക് ബ്രേക്ക്‌ഫാസ്റ്റ് വേണം.`;

      if (breakfastCount > 0) {
        await sock.sendMessage(cateringServiceJID, { text: malayalamMsg });
      }
      await sock.sendMessage(PG_GROUP_JID, { text: breakfastSummaryMsg });
      console.log("✅ Sent breakfast summary");
    } catch (err) {
      console.error(err);
    }
  });

  // Lunch summary (6:30 AM IST)
  cron.schedule("00 01 * * *", async () => {
    const now = new Date();
    const indiaOffsetMs = 5.5 * 60 * 60 * 1000;
    const indiaNow = new Date(now.getTime() + indiaOffsetMs);
    const indiaToday = indiaNow.toISOString().split("T")[0];

    try {
      const res = await axiosRetryRequest({
        method: "GET",
        url: `https://pg-app-backend.onrender.com/detailed_summary?date=${indiaToday}`,
      });
      const orders = res.data.orders;
      if (!orders || orders.length === 0 || res.data.total_orders === 0) return;

      const lunchOrders = orders.filter((o) => o.lunch);
      const lunchNames = lunchOrders.map((o) => o.username);
      const lunchCount = lunchOrders.length;

      const lunchSummaryMsg = `🍛 *Lunch Orders for Today*\n\n${
        lunchNames.length > 0
          ? lunchNames.map((n, i) => `${i + 1}. ${n}`).join("\n")
          : "No orders yet."
      }\n\nNo more orders can be placed for lunch now.`;

      const malayalamMsg = `ചേച്ചി, \n\nഇന്ന് (${indiaToday}),\n${lunchCount} പേർക്ക് ഊണ് വേണം.`;

      if (lunchCount > 0) {
        await sock.sendMessage(cateringServiceJID, { text: malayalamMsg });
      }
      await sock.sendMessage(PG_GROUP_JID, { text: lunchSummaryMsg });
      console.log("✅ Sent lunch summary");
    } catch (err) {
      console.error(err);
    }
  });

  // Dinner summary (12:30 PM IST)
  cron.schedule("00 07 * * *", async () => {
    const now = new Date();
    const indiaOffsetMs = 5.5 * 60 * 60 * 1000;
    const indiaNow = new Date(now.getTime() + indiaOffsetMs);
    const indiaToday = indiaNow.toISOString().split("T")[0];

    try {
      const res = await axiosRetryRequest({
        method: "GET",
        url: `https://pg-app-backend.onrender.com/detailed_summary?date=${indiaToday}`,
      });
      const orders = res.data.orders;
      if (!orders || orders.length === 0 || res.data.total_orders === 0) return;

      const dinnerOrders = orders.filter((o) => o.dinner);
      const dinnerNames = dinnerOrders.map((o) => o.username);
      const dinnerCount = dinnerOrders.length;

      const dinnerSummaryMsg = `🍽️ *Dinner Orders for Today*\n\n${
        dinnerNames.length > 0
          ? dinnerNames.map((n, i) => `${i + 1}. ${n}`).join("\n")
          : "No orders yet."
      }\n\nNo more orders can be placed for dinner now.`;

      const malayalamMsg = `ചേച്ചി, \n\nഇന്ന് (${indiaToday}),\n${dinnerCount} പേർക്ക് രാത്രി ഭക്ഷണം വേണം.`;

      if (dinnerCount > 0) {
        await sock.sendMessage(cateringServiceJID, { text: malayalamMsg });
      }
      await sock.sendMessage(PG_GROUP_JID, { text: dinnerSummaryMsg });
      console.log("✅ Sent dinner summary");
    } catch (err) {
      console.error(err);
    }
  });

  // Daily summary (10 AM IST)
  cron.schedule("30 4 * * *", async () => {
    try {
      const today = new Date();
      const indiaOffsetMs = 5.5 * 60 * 60 * 1000;
      const indiaNow = new Date(today.getTime() + indiaOffsetMs);
      const dateString = indiaNow.toISOString().split("T")[0];

      const res = await axiosRetryRequest({
        method: "GET",
        url: `https://pg-app-backend.onrender.com/detailed_summary?date=${dateString}`,
      });

      const orders = res.data.orders;
      if (res.data.total_orders === 0) {
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
      console.log("✅ Sent 10 AM summary");
    } catch (err) {
      console.error("Summary fetch failed:", err.message);
    }
  });
}

// ===== DYNAMIC REMINDER (your existing logic) =====
async function dynamicReminder(sock) {
  const interval = 120 * 60 * 1000; // 120 minutes

  const checkReplies = async () => {
    try {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();
      const istHour = (utcHour + 5 + Math.floor((utcMinute + 30) / 60)) % 24;

      if (istHour >= 1 && istHour < 6) {
        setTimeout(checkReplies, interval);
        return;
      }

      let targetDate = new Date();
      let day = "today";
      if (istHour >= 20) {
        targetDate.setDate(targetDate.getDate() + 1);
        day = "tomorrow";
      } else if (!(istHour >= 6 && istHour < 13)) {
        setTimeout(checkReplies, interval);
        return;
      }

      const dateString = targetDate.toISOString().split("T")[0];
      const res = await axiosRetryRequest({
        method: "GET",
        url: `https://pg-app-backend.onrender.com/missing_orders?date=${dateString}`,
      });

      const missing = res.data.missing_users || [];
      if (missing.length === 0) {
        await sock.sendMessage(PG_GROUP_JID, {
          text: `✅ All members have already submitted their food orders for *${day}*!`,
        });
        return;
      }

      const mentions = missing.map((m) => m.whatsapp_id);
      const memberListString = missing
        .map((m, i) => `${i + 1}. @${m.whatsapp_id.split("@")[0]} (${m.username})`)
        .join("\n");

      await sock.sendMessage(PG_GROUP_JID, {
        text: `⚠️ The following members have not yet submitted their food orders for *${day}*:\n\n${memberListString}\n\nPlease submit your order ASAP!`,
        mentions: mentions,
      });
    } catch (err) {
      console.error("❌ Dynamic reminder fetch failed:", err.message);
    }

    setTimeout(checkReplies, interval);
  };

  setTimeout(checkReplies, 0);
}

// ===== START BOT =====
startSock().catch(console.error);