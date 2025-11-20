# PG APP — WhatsApp Meal Ordering Bot

> Lightweight WhatsApp bot part for an PG Agent that collects daily meal orders from a PG (paying-guest) group, posts summaries, and notifies the catering service. Built with Baileys and a small backend API.

**Tech stack**: Node.js, @whiskeysockets/baileys, axios, node-cron, qrcode

**Status:** Working prototype — run locally or on a server (Render, Heroku, VPS).

**Quick links**

- Code: `pg.js`
- Test (console-only): `test.js`
- Package manifest: `package.json`

**What the project does**

- Connects to WhatsApp using the Baileys library and a multi-file auth state.
- Listens for messages in a configured group (constants in `pg.js`) and forwards them to a backend API for processing.
- Runs cron jobs that:
  - Send evening reminders to the group
  - Produce breakfast/lunch/dinner summaries and notify the catering service (only when orders exist)
  - Ping the backend periodically to keep hosting services awake
  - Run a dynamic reminder loop for missing orders

**Why this is useful**

- Automates daily meal collection and reduces manual tallying.
- Sends structured reminders and counts to both the PG group and the catering service.
- Keeps the backend alive to avoid cold starts on platforms like Render.

**Getting started**

Prerequisites

- Node.js 18+ (or recent LTS)
- npm or yarn

Install

```powershell
cd "c:\Users\anasm\OneDrive\Documents\Projectss\PG APP"
npm install
```

Start the bot

```powershell
npm start
# or
node pg.js
```

Notes:

- On first run the bot will print a QR code to the terminal. Scan it from your WhatsApp mobile to authenticate. Baileys stores credentials under the `auth_info_baileys/` folder.
- The project is an ES module (`"type": "module"` in `package.json`).

**Testing without WhatsApp**

- Use `test.js` when you want to simulate receiving messages and see console-only output. This file is useful for debugging the cron logic without sending WhatsApp messages.

**Configuration**

- Open `pg.js` and edit the constants at the top:
  - `PG_GROUP_JID` — your group JID
  - `cateringServiceJID` — catering WhatsApp JID
  - `PG_MEMBERS` — the list of known members and their WhatsApp IDs
- Backend endpoints used by the bot (change these in `pg.js` if needed):
  - `https://pg-app-backend.onrender.com/process` — POST for processing incoming messages
  - `https://pg-app-backend.onrender.com/detailed_summary` — GET for day summaries
  - `https://pg-app-backend.onrender.com/missing_orders` — GET for missing orders

**Behaviour notes**

- The bot converts server time to IST for scheduling reminders.
- Catering service messages are only sent when there is at least one order for the meal.
- The bot pings the backend every 5 minutes to avoid idle shutdowns on some hosting providers.

**Security & data**

- `auth_info_baileys/` contains WhatsApp session credentials — keep it private and do not commit it to git.

**Troubleshooting**

- If QR doesn't show, confirm your terminal supports QR output (`qrcode-terminal` prints an ASCII QR). The bot also logs a data-URL for the QR which can be opened in a browser.
- If the bot repeatedly disconnects with `DisconnectReason.loggedOut`, remove the stale `auth_info_baileys/` directory and re-authenticate.

**Contributing**

- Contributions are welcome. Open issues for bugs and feature requests.
- See `package.json` for the start script and dependencies.

**Where to get help**

- Open an issue in this repository or reach out to the maintainer via the project issue tracker.

**Maintainers**

- Repository owner: `anazmuhdd` (see repo settings for contact details).

**License**

- See the repository `LICENSE` file (if present). If no license file exists, assume all rights reserved.

---

Generated README based on project files: `pg.js`, `test.js`, and `package.json`.
