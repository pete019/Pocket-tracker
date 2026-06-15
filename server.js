const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
let google; // google will be required lazily if service account is present

// Security & logging
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.SHEET_ID || '1G7ranAG_nHqS_sMB1xP-1YoKvkk1GLvB';
const PUBLIC_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
const CACHE_MS = 2 * 60 * 1000;
let sheetCache = { timestamp: 0, rows: [] };

// Trust proxy when behind a load balancer/proxy (set TRUST_PROXY=true in production if needed)
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

// CORS: restrict origin in production via CORS_ORIGIN env (comma-separated), default allow all for local use
const corsOrigin = process.env.CORS_ORIGIN;
const corsOptions = corsOrigin ? { origin: corsOrigin.split(',').map(s => s.trim()) } : {};

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.static(path.join(__dirname)));

// Rate limiting (global), tune as needed
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.RATE_LIMIT_MAX) || 200 });
app.use(limiter);

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.json({ rows: [] });
  if (query.length > 200) return res.status(400).json({ error: 'Query too long' });

  try {
    const rows = await loadSheetRows();
    const normalized = query.toLowerCase();
    const matches = rows.filter(row =>
      [row.admissionNo, row.studentName, row.className, row.fatherName, row.motherName, row.phone]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    );
    res.json({ rows: matches });
  } catch (err) {
    console.error('Search error', err.message || err);
    res.status(500).json({ error: 'Failed to search records' });
  }
});

app.post('/api/parse', async (req, res) => {
  const message = String(req.body.message || '').trim();
  const sender = String(req.body.sender || '').trim();

  if (!message) return res.status(400).json({ error: 'message is required' });
  if (message.length > 2000) return res.status(400).json({ error: 'message too long' });

  try {
    const parsed = parseMpesaSms(message, sender);
    const rows = await loadSheetRows();
    const matches = filterRows(rows, parsed);
    res.json({ parsed, rows: matches });
  } catch (err) {
    console.error('Parse error', err.message || err);
    res.status(500).json({ error: 'Failed to parse message' });
  }
});

app.post('/api/webhook', async (req, res) => {
  const payload = req.body || {};
  const message = String(payload.text || payload.message || payload.sms || payload.body || '').trim();
  const sender = String(payload.from || payload.sender || payload.address || payload.msisdn || '').trim();

  if (!message) return res.status(400).json({ error: 'SMS message text is required' });
  if (message.length > 2000) return res.status(400).json({ error: 'message too long' });

  try {
    const parsed = parseMpesaSms(message, sender);
    const rows = await loadSheetRows();
    const matches = filterRows(rows, parsed);

    // Log the webhook content for debugging
    console.info('SMS webhook received:', { sender: sender || 'unknown', parsedSummary: { amount: parsed.amount, phone: parsed.phoneNumber }, matchesLength: matches.length });

    res.json({ status: 'ok', parsed, rows: matches });
  } catch (err) {
    console.error('Webhook error', err.message || err);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

app.get('/api/debug', async (req, res) => {
  try {
    const rows = await loadSheetRows();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server with graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`Web app listening on http://localhost:${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(err => {
    if (err) {
      console.error('Error during shutdown', err);
      process.exit(1);
    }
    console.log('Shutdown complete.');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

async function loadSheetRows() {
  const now = Date.now();
  if (sheetCache.rows.length && now - sheetCache.timestamp < CACHE_MS) {
    return sheetCache.rows;
  }

  const rows = await fetchSheetRows();
  sheetCache = { timestamp: now, rows };
  return rows;
}

async function fetchSheetRows() {
  const serviceAccountPath = path.join(__dirname, 'service_account.json');
  if (fs.existsSync(serviceAccountPath)) {
    try {
      return await fetchRowsWithServiceAccount(serviceAccountPath);
    } catch (error) {
      console.error('Service account fetch failed:', error.message);
    }
  }

  try {
    return await fetchRowsFromPublicSheet();
  } catch (error) {
    console.error('Public sheet fetch failed:', error.message);
    return [];
  }
}

async function fetchRowsWithServiceAccount(keyFile) {
  // Require googleapis only when needed so the app can run using the public sheet without
  // installing googleapis/service account dependencies.
  try {
    if (!google) {
      const gp = require('googleapis');
      google = gp.google;
    }
  } catch (e) {
    throw new Error('googleapis module is required for service account access. Install dependencies with npm install');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'A:F',
  });

  const values = response.data.values || [];
  return parseRows(values);
}

async function fetchRowsFromPublicSheet() {
  const response = await axios.get(PUBLIC_SHEET_URL);
  const text = String(response.data || '');
  const token = 'google.visualization.Query.setResponse(';
  const start = text.indexOf(token);
  if (start < 0) {
    throw new Error('Unable to locate sheet JSON in the public response.');
  }

  const jsonText = text
    .substring(start + token.length)
    .trim()
    .replace(/\);?\s*$/, '');

  const data = JSON.parse(jsonText);
  const rows = (data.table?.rows || []).map(row => row.c || []);

  const values = rows.map(cells =>
    cells.map(cell => (cell ? cell.v : ''))
  );

  return parseRows(values);
}

function parseRows(values) {
  return values.slice(1).map(row => ({
    admissionNo: String(row[0] || ''),
    studentName: String(row[1] || ''),
    className: String(row[2] || ''),
    fatherName: String(row[3] || ''),
    motherName: String(row[4] || ''),
    phone: String(row[5] || ''),
  })).filter(record => record.studentName || record.phone);
}

function filterRows(rows, parsed) {
  const queryParts = [];
  if (parsed.phoneNumber) queryParts.push(normalizePhone(parsed.phoneNumber));
  if (parsed.senderName) queryParts.push(parsed.senderName.toLowerCase());
  const query = queryParts.join(' ').trim();
  if (!query) return [];

  return rows.filter(row => {
    const fields = [row.admissionNo, row.studentName, row.className, row.fatherName, row.motherName, row.phone]
      .join(' ')
      .toLowerCase();
    const normalizedQuery = query.toLowerCase();
    return normalizedQuery.split(/\s+/).every(term => fields.includes(term));
  });
}

function parseMpesaSms(body, sender) {
  const cleaned = String(body || '').trim();

  const amount = extractAmount(cleaned);
  const senderName = extractSenderName(cleaned) || sender || '';
  const phoneNumber = extractPhoneNumber(cleaned) || sender || '';
  const transactionType = extractTransactionType(cleaned);
  const isMpesa = /mpesa|received|credited|debited|sent/i.test(cleaned);

  return {
    body: cleaned,
    senderName: senderName.trim(),
    phoneNumber: phoneNumber.trim(),
    amount,
    transactionType,
    isMpesa,
  };
}

function extractAmount(body) {
  const match = body.match(/(?:Ksh|KES|Shs|KES\.?|KSH)\s*([0-9,.]+)/i);
  return match ? match[1] : null;
}

function extractSenderName(body) {
  const match = body.match(/from\s+([A-Za-z ]{3,80}?)(?:\s+\+?\d|\s*\.|\s*Ksh|\s*KES|\s*Shs|\s*on)/i);
  return match ? match[1].trim() : null;
}

function extractPhoneNumber(body) {
  const match = body.match(/\b(?:\+254|0)(?:7\d{8}|1\d{8}|2\d{8})\b/);
  return match ? match[0] : null;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[\s\-()]+/g, '').toLowerCase();
}
