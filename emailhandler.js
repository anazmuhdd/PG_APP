// ===== EMAIL SETUP =====
import nodemailer from "nodemailer";
const EMAIL_TRANSPORTER = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: "anazmohammed4games@gmail.com",      
    pass: "kgypohjdqwapyceu",             
  },
});

async function sendAlertEmail(originalMsg, replyMsgId) {
  console.warn("Sending email...");
  await EMAIL_TRANSPORTER.sendMail({
    from: 'anazmohammed4games@gmail.com',
    to: "anasmonar@gmail.com",
    subject: "❗ Auto-Reply Not Seen – Follow Up Needed",
    text: `Your friend sent: "${originalMsg}"\n\nYour auto-reply (ID: ${replyMsgId}) was not seen within 2 hours.\nPlease call or check manually.`,
  });
  console.warn("Email sent!");
}

export { sendAlertEmail };