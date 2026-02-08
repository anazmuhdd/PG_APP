import {
  useMultiFileAuthState,
  makeWASocket,
  DisconnectReason,
  Browsers,
} from "@whiskeysockets/baileys";
import axios from "axios";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import pino from "pino";

// ===== CONFIG (Same as pg.js) =====
const cateringServiceJID = "919847413782@s.whatsapp.net";

// Members list (from pg.js)
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

const BACKEND_URL = "https://pg-app-backend-7pq9.onrender.com";
const ORDER_DETAILS_WEBSITE =
  process.env.ORDER_DETAILS_WEBSITE || "https://rajahamsam-pg.vercel.app/";

// Get billing month from env or use default (11 for November)
const BILLING_MONTH = process.env.BILLING_MONTH || "12";
const BILLING_YEAR = process.env.BILLING_YEAR || "2025";
const MONTH_FULL = `${BILLING_YEAR}-${BILLING_MONTH.padStart(2, "0")}`;

console.log("✅ Billing Bot Config loaded:");
console.log(`   Members: ${PG_MEMBERS.length}`);
console.log(`   Backend: ${BACKEND_URL}`);
console.log(`   Billing Month: ${MONTH_FULL}`);
console.log(`   Order Details Website: ${ORDER_DETAILS_WEBSITE}`);

// ===== UTILS =====
async function axiosRetryRequest(config, retries = 3, delay = 1000) {
  try {
    return await axios(config);
  } catch (err) {
    if (err.response && err.response.status === 500 && retries > 0) {
      console.warn(
        `⚠️ Server 500 error. Retrying ${config.url} in ${delay}ms...`,
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
    } catch (err) {
      console.warn(
        "presence: failed to send 'unavailable'",
        err?.message || err,
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

// ===== BILLING LOGIC =====
async function sendMonthlyBillingMessages(sock) {
  try {
    console.log("\n📊 Starting monthly billing process...");
    console.log(`📅 Processing billing for month: ${MONTH_FULL}`);

    const billingData = {};
    const failedMembers = [];

    // Fetch orders for each member
    for (const member of PG_MEMBERS) {
      try {
        console.log(`⏳ Fetching orders for ${member.name}...`);

        const res = await axiosRetryRequest({
          method: "GET",
          url: `${BACKEND_URL}/orders/${member.id}/${MONTH_FULL}`,
        });

        const memberOrders = res.data.orders || [];
        const totalAmount = memberOrders.reduce(
          (sum, order) => sum + order.total_amount,
          0,
        );

        billingData[member.name] = {
          whatsappId: member.id,
          orders: memberOrders,
          totalAmount,
        };

        console.log(
          `✅ ${member.name}: ${memberOrders.length} orders, ₹${totalAmount}`,
        );
      } catch (err) {
        console.warn(
          `⚠️ Failed to fetch orders for ${member.name}:`,
          err.message,
        );
        failedMembers.push(member.name);
        billingData[member.name] = {
          whatsappId: member.id,
          orders: [],
          totalAmount: 0,
          error: err.message,
        };
      }
    }

    // Send individual PERSONAL messages to each member ONLY
    console.log("\n💬 Sending personal billing messages to members...");
    let successCount = 0;
    let skipCount = 0;

    for (const member of PG_MEMBERS) {
      const billing = billingData[member.name];
      const { totalAmount, orders } = billing;

      // Skip if no orders
      if (totalAmount === 0) {
        console.log(
          `⏭️  Skipping ${member.name} (no orders for ${MONTH_FULL})`,
        );
        skipCount++;
        continue;
      }

      // Build order details
      const orderSummary = orders
        .map((o) => {
          const meals = [
            o.breakfast ? "🍳 B" : "",
            o.lunch ? "🍛 L" : "",
            o.dinner ? "🍽️ D" : "",
          ]
            .filter(Boolean)
            .join(" | ");
          return `  • ${o.order_date}: ${meals} - ₹${o.total_amount}`;
        })
        .join("\n");

      // Personal message (only to individual)
      const message = `💳 *Monthly Billing - ${MONTH_FULL}*

Hello ${member.name},

Your total food order amount for *December* is:

🔢 *₹${totalAmount}*


📊 View your full order history at:
${ORDER_DETAILS_WEBSITE}

Please make the payment at your earliest convenience.
If paid, reply as paid.

Thank you! 🙏`;

      try {
        // Send ONLY to the individual (not to group, not to catering service)
        await sock.sendMessage(member.id, { text: message });
        console.log(`✅ Sent personal billing message to ${member.name}`);
        successCount++;
      } catch (err) {
        console.error(
          `❌ Failed to send message to ${member.name}:`,
          err.message,
        );
      }

      console.log(`\n--- Message Preview for ${member.name} ---\n`);
      console.log(message);

      // Add delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log("\n✅ Billing process completed!");
    console.log(`   - Successfully notified: ${successCount} members`);
    console.log(`   - Skipped (no orders): ${skipCount} members`);
    if (failedMembers.length > 0) {
      console.log(`   - Failed: ${failedMembers.join(", ")}`);
    }
  } catch (err) {
    console.error("❌ Billing process failed:", err.message);
  }
}

// ===== MAIN BOT =====
async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: Browsers.macOS("WhatsApp Billing Bot"),
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
    shouldSyncHistoryMessages: () => false,
    logger: pino({
      level: "silent",
    }),
  });

  const presenceCtrl = createPresenceController(sock);

  sock.ev.on(
    "connection.update",
    async ({ connection, qr, lastDisconnect }) => {
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
          presenceCtrl.startHeartbeat(5 * 60 * 1000);
        } catch (err) {
          console.warn("presence initial update failed:", err?.message || err);
        }

        // Start billing process immediately after connection
        console.log("\n⏱️  Starting billing process in 2 seconds...");
        setTimeout(() => sendMonthlyBillingMessages(sock), 2000);
      }
    },
  );

  sock.ev.on("creds.update", saveCreds);
}

startSock().catch(console.error);
