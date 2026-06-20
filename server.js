// server.js — Express + SQLite WAL sync endpoint
// 车间设备巡检登记表

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// --- Device whitelist (must match index.html DEVICE_LIST) ---
const DEVICE_LIST = [
  'shadds-01', 'shadds-02', 'shadds-03', 'shadds-04', 'shadds-05',
  'shadds-06', 'shadds-07', 'shadds-08', 'shadds-09', 'shadds-10',
  'shadds-11', 'shadds-12', 'shadds-13', 'shadds-14', 'shadds-15',
  'shadds-16', 'shadds-17', 'shadds-18', 'shadds-19', 'shadds-20'
];

const VALID_STATUSES = ['正常', '异常', '待维修'];

// --- SQLite setup ---
const db = new Database('inspections.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('正常', '异常', '待维修')),
    inspector TEXT NOT NULL,
    note TEXT DEFAULT '',
    client_created_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    submitter_ip TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_inspections_device ON inspections(device_id);
  CREATE INDEX IF NOT EXISTS idx_inspections_created ON inspections(created_at);
  CREATE INDEX IF NOT EXISTS idx_inspections_inspector ON inspections(inspector);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_inspections_dedup
    ON inspections(device_id, inspector, client_created_at);

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    triggered_inspection_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolved_by TEXT,
    FOREIGN KEY (triggered_inspection_id) REFERENCES inspections(id)
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts(device_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active ON alerts(device_id) WHERE resolved_at IS NULL;
`);

console.log('SQLite WAL mode ready, schema ensured.');

// --- Prepared statements ---
const stmtInsert = db.prepare(`
  INSERT INTO inspections (device_id, status, inspector, note, client_created_at, submitter_ip)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtQuery = db.prepare(`
  SELECT id, device_id, status, inspector, note, created_at
  FROM inspections
  ORDER BY created_at DESC
  LIMIT ?
`);

const stmtQueryDevice = db.prepare(`
  SELECT id, device_id, status, inspector, note, created_at
  FROM inspections
  WHERE device_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

const stmtQueryCount = db.prepare('SELECT COUNT(*) as total FROM inspections');
const stmtQueryCountDevice = db.prepare('SELECT COUNT(*) as total FROM inspections WHERE device_id = ?');

// --- Alert prepared statements ---
const stmtCheckConsecutive = db.prepare(`
  WITH ranked AS (
    SELECT id, device_id, status,
      ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY created_at DESC) as rn
    FROM inspections
    WHERE device_id = ?
  )
  SELECT * FROM ranked WHERE rn <= 2
`);

const stmtCheckActiveAlert = db.prepare(`
  SELECT id FROM alerts WHERE device_id = ? AND resolved_at IS NULL
`);

const stmtInsertAlert = db.prepare(`
  INSERT INTO alerts (device_id, triggered_inspection_id) VALUES (?, ?)
`);

const stmtQueryAlerts = db.prepare(`
  SELECT a.id, a.device_id, a.created_at,
    i.status, i.inspector, i.note, i.created_at as triggered_at
  FROM alerts a
  JOIN inspections i ON i.id = a.triggered_inspection_id
  WHERE a.resolved_at IS NULL
  ORDER BY a.created_at DESC
`);

const stmtResolveAlert = db.prepare(`
  UPDATE alerts SET resolved_at = datetime('now'), resolved_by = ? WHERE id = ?
`);

// --- Express app ---
const app = express();

// Body parser: only accept JSON
app.use(express.json({ limit: '16kb' }));

// CORS: restrictive by default — only serve requests from the same server
// or from localhost. For intranet deployment, set ALLOWED_ORIGINS env.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use((req, res, next) => {
  const origin = req.get('origin');
  // If no origin header (same-origin request, curl, etc.), allow it
  if (!origin) return next();
  // If allowed origins configured, check against them
  if (ALLOWED_ORIGINS.length > 0) {
    const allowed = ALLOWED_ORIGINS.includes(origin);
    if (allowed) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
    }
    // Otherwise: no CORS headers (default deny for cross-origin)
  } else {
    // No explicit allowlist: allow same-origin only by not setting CORS headers
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- Rate limiting ---
const reqCounts = new Map();
setInterval(() => reqCounts.clear(), 60000); // Reset every 60s
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const count = (reqCounts.get(key) || 0) + 1;
    reqCounts.set(key, count);
    if (count > 100) {
      return res.status(429).json({ error: 'rate_limited', message: '请求过于频繁，请稍后再试' });
    }
  }
  next();
});

// POST /api/inspections — submit a new inspection record
app.post('/api/inspections', (req, res) => {
  const { device_id, status, inspector, note, client_created_at } = req.body;

  // Validate device_id
  if (!device_id || !DEVICE_LIST.includes(device_id)) {
    return res.status(400).json({
      error: 'invalid_field',
      field: 'device_id',
      message: '设备编号不在设备列表中'
    });
  }

  // Validate status
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'invalid_field',
      field: 'status',
      message: '状态必须是 正常 / 异常 / 待维修'
    });
  }

  // Validate inspector (max 50 chars)
  const inspectValidator = /^\p{L}{1,50}$/u;
if (!inspector || typeof inspector !== 'string' || !inspector.trim() || !inspectValidator.test(inspector.trim())) {
    return res.status(400).json({
      error: 'invalid_field',
      field: 'inspector',
      message: '巡检人姓名不能为空，仅支持中文或字母，不超过50个字符'
    });
  }

  // Validate note length (count Unicode codepoints, not UTF-16 units)
  const safeNote = (typeof note === 'string') ? [...note].slice(0, 1000).join('') : '';

  // Validate client_created_at
  if (!client_created_at) {
    return res.status(400).json({
      error: 'invalid_field',
      field: 'client_created_at',
      message: '客户端时间戳不能为空'
    });
  }

  const submitter_ip = req.ip || req.socket.remoteAddress || '';

  try {
    const result = stmtInsert.run(
      device_id,
      status,
      inspector.trim(),
      safeNote,
      client_created_at,
      submitter_ip
    );

    const row = db.prepare('SELECT id, created_at FROM inspections WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      id: row.id,
      created_at: row.created_at
    });
  } catch (err) {
    console.error('Insert error:', err.message);
    res.status(500).json({
      error: 'internal_error',
      message: '服务器内部错误，请重试'
    });
  }
});

// GET /api/inspections — query records
app.get('/api/inspections', (req, res) => {
  const { device_id, date_from, date_to, inspector, limit } = req.query;
  const lim = Math.min(parseInt(limit) || 200, 2000);

  let where = [];
  let params = [];

  if (device_id) {
    // Support comma-separated multiple devices
    const devices = device_id.split(',').map(d => d.trim()).filter(Boolean);
    if (devices.length === 1) {
      where.push('device_id = ?');
      params.push(devices[0]);
    } else if (devices.length > 1) {
      where.push(`device_id IN (${devices.map(() => '?').join(',')})`);
      params.push(...devices);
    }
  }

  if (date_from) {
    where.push('created_at >= ?');
    params.push(date_from);
  }

  if (date_to) {
    where.push('created_at <= ?');
    params.push(date_to);
  }

  if (inspector) {
    where.push('inspector = ?');
    params.push(inspector.trim());
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const records = db.prepare(
      `SELECT id, device_id, status, inspector, note, created_at
       FROM inspections ${whereClause}
       ORDER BY created_at DESC LIMIT ?`
    ).all(...params, lim);

    const count = db.prepare(
      `SELECT COUNT(*) as total FROM inspections ${whereClause}`
    ).get(...params);

    res.json({ records, total: count.total });
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({
      error: 'internal_error',
      message: '服务器内部错误，请重试'
    });
  }
});

// Serve static files — ONLY index.html, not server source
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});

app.listen(PORT, HOST, () => {
  console.log(`巡检登记服务已启动: http://${HOST}:${PORT}`);
  console.log(`静态文件目录: ${__dirname}`);
});
