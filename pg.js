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
  { id: "919778250566@s.whatsapp.net", name: "Anas Ikka" },
  { id: "919074211782@s.whatsapp.net", name: "Akash Ettayi" },
  { id: "919645829304@s.whatsapp.net", name: "Akhii Bhaii" },
  { id: "919188775142@s.whatsapp.net", name: "Alvin Puliveli" },
  { id: "917306731189@s.whatsapp.net", name: "Sheikhikka" },
  { id: "919207066956@s.whatsapp.net", name: "Kasi Kutta" },
  { id: "916238007254@s.whatsapp.net", name: "Kuriappi" },
  { id: "919188712388@s.whatsapp.net", name: "Pro Nihal" },
  { id: "919207605231@s.whatsapp.net", name: "Chunnikutta" },
  { id: "918590730424@s.whatsapp.net", name: "Vishuu" },
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
    if (jid !== PG_GROUP_JID || !msg.message || msg.key.fromMe) return;

    const sender = msg.key.participantAlt || msg.key.participant;
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

      await sock.sendMessage(
        jid,
        { text: reply || "✅ Order received" },
        { quoted: msg }
      );
    } catch (err) {
      await sock.sendMessage(jid, {
        text: "Application server down. Please try again",
      });
      console.error("Backend error (process):", err.message);
    }
  });

  // Keep backend alive
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

  // Evening reminder + start dynamic reminders
  cron.schedule("00 14 * * *", async () => {
    await sock.sendMessage(PG_GROUP_JID, {
      text: "📢 Good evening! Please submit your food order for tomorrow.\n\nFor breakfast and lunch please order before 9PM",
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
      if (!orders || orders.length === 0 || res.data.total_orders === 0) {
        return;
      }

      const breakfastOrders = orders.filter((o) => o.breakfast);
      const breakfastNames = breakfastOrders.map((o) => o.username);
      const breakfastCount = breakfastOrders.length;
      const lunchOrders = orders.filter((o) => o.lunch);
      const lunchNames = lunchOrders.map((o) => o.username);
      const lunchCount = lunchOrders.length;

      const breakfastSummaryMsg = `🍳 *Breakfast Orders for Tomorrow*\n\n${
        breakfastNames.length > 0
          ? breakfastNames.map((n, i) => `${i + 1}. ${n}`).join("\n")
          : "No orders yet."
      }\n\nNo more orders can be placed for breakfast now.`;

      await sock.sendMessage(PG_GROUP_JID, { text: breakfastSummaryMsg });

      console.log("✅ Sent breakfast summary to group and catering service");

      const lunchSummaryMsg = `🍛 *Lunch Orders for Today*\n\n${
        lunchNames.length > 0
          ? lunchNames.map((n, i) => `${i + 1}. ${n}`).join("\n")
          : "No orders yet."
      }\n\nNo more orders can be placed for lunch now.`;

      await sock.sendMessage(PG_GROUP_JID, { text: lunchSummaryMsg });
      console.log("✅ Sent lunch summary to group and catering service");

      const malayalamMsg = `ചേച്ചി, \n\nനാളെ (${indiaTomorrow}),\n${breakfastCount} പേർക്ക് ബ്രേക്ക്‌ഫാസ്റ്റ് വേണം.
      \n${lunchCount} പേർക്ക് ഊണ് വേണം.`;

      if (breakfastCount > 0 || lunchCount > 0) {
        await sock.sendMessage(cateringServiceJID, { text: malayalamMsg });
        await sock.sendMessage(PG_GROUP_JID, {
          text: "*Order for Breakfast and Lunch placed to Catering service.*",
        });
      }
    } catch (err) {
      console.error(err);
    }
  });

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
      if (!orders || orders.length === 0 || res.data.total_orders === 0) {
        return;
      }

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
      console.log("✅ Sent dinner summary to group and catering service");
      await sock.sendMessage(PG_GROUP_JID, {
        text: "*Order for Dinner placed to Catering service.*",
      });
    } catch (err) {
      console.error(err);
    }
  });

  cron.schedule("30 7 * * *", async () => {
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
      console.log("✅ Sent 10 AM summary to group");
    } catch (err) {
      console.error("Summary fetch failed:", err.message);
    }
  });
}

// Dynamic reminders loop
async function dynamicReminder(sock) {
  const interval = 120 * 60 * 1000; // 120 minutes

  const checkReplies = async () => {
    try {
      const now = new Date();

      // Correct IST conversion
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      const istHour = ist.getHours();

      console.log("IST Hour:", istHour);

      // Skip 1 AM - 6 AM
      if (istHour >= 1 && istHour < 6) {
        console.log("😴 Sleeping hours 1 AM - 6 AM → skipping");
        return setTimeout(checkReplies, interval);
      }

      let targetDate = new Date();
      let day = "today";

      if (istHour >= 6 && istHour < 13) {
        console.log("🌞 Checking today's orders");
      } else if (istHour >= 20) {
        targetDate.setDate(targetDate.getDate() + 1);
        day = "tomorrow";
        console.log("🌙 Checking tomorrow's orders");
      } else {
        console.log("⏳ No reminder window now");
        return setTimeout(checkReplies, interval);
      }

      const dateString = targetDate.toISOString().split("T")[0];

      const res = await axiosRetryRequest({
        method: "GET",
        url: `https://pg-app-backend.onrender.com/missing_orders?date=${dateString}`,
      });

      const missing = res.data.missing_users || [];
      console.log(`Missing count: ${missing.length}`);

      if (missing.length === 0) {
        await sock.sendMessage(PG_GROUP_JID, {
          text: `✅ All members have submitted their food orders for *${day}*!`,
        });
        return setTimeout(checkReplies, interval);
      }

      const mentions = missing.map((m) => m.whatsapp_id);
      const listString = missing
        .map(
          (m, i) => `${i + 1}. @${m.whatsapp_id.split("@")[0]} (${m.username})`
        )
        .join("\n");

      await sock.sendMessage(PG_GROUP_JID, {
        text: `⚠️ The following members have not submitted their orders for *${day}*:\n\n${listString}\n\nPlease submit ASAP!`,
        mentions,
      });
    } catch (err) {
      console.error("❌ Dynamic reminder failed:", err.message);
    }

    setTimeout(checkReplies, interval);
  };

  checkReplies();
}

// Start bot
startSock().catch(console.error);
