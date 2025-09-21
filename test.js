const axios = require("axios");
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

async function checkReplies() {
  try {
    const interval = 10000; // 10 seconds for demo
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    const istHour = (utcHour + 5 + Math.floor((utcMinute + 30) / 60)) % 24;
    console.log(`IST Hour: ${istHour}`);
    console.log(`Checking for missing orders at ${now.toLocaleTimeString()}`);

    // Skip reminders between 1 AM and 6 AM
    if (istHour >= 1 && istHour < 6) {
      console.log("😴 Sleeping hours (1 AM - 6 AM). Skipping reminders.");
      setTimeout(checkReplies, interval);
      return;
    }

    // Decide whether to check today's or tomorrow's orders
    let targetDate = new Date();
    let day = "today";
    if (istHour >= 20 && istHour <= 1) {
      targetDate.setDate(targetDate.getDate() + 1);
      console.log("🌙 After 8 PM → Checking tomorrow's orders");
      day = "tomorrow";
    } else if (istHour >= 6 && istHour < 13) {
      console.log("🌞 Between 6 AM - 1 PM → Checking today's orders");
      day = "today";
    } else {
      console.log("🕛 Midnight - 1 AM edge case. Skipping.");
      setTimeout(checkReplies, interval);
      return;
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

    const member_list_string = missing.map((m) => m.username).join("\n");
    console.log(
      `⚠️ The following members have not yet submitted their food orders for *${day}*:\n\n${member_list_string}\n\nPlease submit your order ASAP!`
    );

    // keep checking again after interval
    setTimeout(checkReplies, interval);
  } catch (err) {
    console.error("❌ Dynamic reminder fetch failed:", err.message);
    setTimeout(checkReplies, 10000); // retry anyway
  }
}

// Start loop
checkReplies();
