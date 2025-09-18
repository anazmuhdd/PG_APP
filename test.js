const axios = require("axios");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const cron = require("node-cron");
// This code does NOT correctly get tomorrow's date in India time.
// It uses UTC date, but the logic is incorrect and will not work as intended.
const now = new Date();
const indiaOffsetMs = 5.5 * 60 * 60 * 1000; // IST offset in milliseconds
const indiaNow = new Date(now.getTime() + indiaOffsetMs);
indiaNow.setDate(indiaNow.getDate());
const indiaTomorrow = indiaNow.toISOString().split("T")[0];
console.log(indiaTomorrow);
try {
  const res = axios
    .get(
      `https://pg-app-backend.onrender.com/detailed_summary?date=${indiaTomorrow}`
    )
    .then((res) => {
      console.log(res.data);
      const orders = res.data.orders;
      if (!orders || orders.length === 0) {
        return;
      }
      // Filter breakfast orders
      const breakfastOrders = orders.filter((order) => order.breakfast);
      const breakfastCount = breakfastOrders.length;
      const breakfastNames = breakfastOrders.map((order) => order.username);

      // Prepare messages
      const breakfastSummaryMsg = `Breakfast Orders placed tomorrow for: \n\n ${breakfastNames.join(
        "\n"
      )}`;
      const breakfastCountMsg = `Breakfast count: ${breakfastCount}`;

      console.log(breakfastSummaryMsg);
      console.log(breakfastCountMsg);

      // You can send these messages to your bot here
    });
} catch (err) {
  console.error(err);
}
