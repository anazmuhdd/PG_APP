import express from 'express';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { Mutex } from 'async-mutex';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  delay,
  Browsers
} from '@whiskeysockets/baileys';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

const mutex = new Mutex();
let session = null;
const sessionDir = path.join(__dirname, 'session');

// Ensure session directory exists
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

/**
 * connector: initiates socket, handles connection updates, and sends pairing code on connection open.
 * Implements retry with exponential backoff on disconnect.
 * @param {string} phoneNumber Raw numeric string (no +, no spaces)
 * @param {express.Response} res HTTP response to send pairing code JSON
 * @param {number} attempt current retry attempt number
 */
async function connector(phoneNumber, res, attempt = 1) {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  console.log(`>>>> Starting a new socket session for ${phoneNumber}, attempt ${attempt}`);

  session = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    browser: Browsers.macOS('Safari'),
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    printQRInTerminal: false
  });

  session.ev.on('creds.update', (newCreds) => {
    console.log('Creds updated, saving...');
    saveCreds(newCreds);
  });

  session.ev.on('connection.update', async (update) => {
    console.log('Connection Update:', update);
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('✅ Connected to WhatsApp (socket open).');

      if (!session.authState.creds.registered) {
        try {
          console.log('Requesting pairing code...');
          const code = await session.requestPairingCode(phoneNumber);
          const prettyCode = code?.match(/.{1,4}/g)?.join('-') || code;
          console.log('📱 Pairing Code generated:', prettyCode);
          if (!res.headersSent) {
            res.json({ pairingCode: prettyCode });
          }
        } catch (err) {
          console.error('❌ Error generating pairing code:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to get pairing code', details: err.toString() });
          }
        }
      } else {
        console.log('Already registered — no pairing code needed.');
        if (!res.headersSent) {
          res.json({ message: 'Already registered / session exists' });
        }
      }
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.warn(`❌ Socket closed, reason code = ${code}`);

      if (
        code !== DisconnectReason.loggedOut &&
        code !== DisconnectReason.badSession
      ) {
        if (attempt <= 5) {
          const delayTime = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`🔄 Attempting reconnect in ${delayTime / 1000}s (attempt ${attempt})`);
          await delay(delayTime);
          await connector(phoneNumber, res, attempt + 1);
        } else {
          console.error('❌ Max retry attempts reached. Giving up.');
          if (!res.headersSent) {
            res.status(500).json({ error: 'Max reconnect attempts reached' });
          }
        }
      } else {
        console.log('Logged out / bad session. Will not auto reconnect.');
      }
    }
  });
}

app.get('/pair', async (req, res) => {
  const phoneNumberRaw = req.query.code;
  if (!phoneNumberRaw) {
    return res.status(400).json({ error: 'Missing phone number (query “code” param)' });
  }
  const phone = phoneNumberRaw.replace(/[^0-9]/g, '');

  const release = await mutex.acquire();
  try {
    await connector(phone, res);
  } catch (err) {
    console.error('Internal connector error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', details: err.toString() });
    }
  } finally {
    release();
  }
});

app.listen(port, () => {
  console.log(`🟢 Server listening on http://localhost:${port}`);
});
