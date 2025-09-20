const axios = require("axios");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const cron = require("node-cron");
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
(async () => {
  try {
    const dateString = "2025-09-18"; // Change to desired date for testing

    console.log("Fetching summary for date:", dateString);

    const res = await axiosRetryRequest({
      method: "GET",
      url: `https://pg-app-backend.onrender.com/detailed_summary?date=${dateString}`,
    });

    const orders = res.data.orders;
    console.log("Fetched today's orders:", orders);

    if (res.data.total_orders === 0) {
      console.log("📊 No orders found for today yet.");
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

    console.log(summary);
    console.log("✅ Sent 10 AM summary to group (simulated)");
  } catch (err) {
    console.error("Summary fetch failed:", err.message);
  }
})();
