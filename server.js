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

// --- Express app ---
const app = express();

// Body parser: only accept JSON
app.use(express.json({ limit: '16kb' }));

// CORS: restrict to local origins (browsers on the intranet)
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', req.get('origin') || '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- API routes ---

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

  // Validate inspector
  if (!inspector || typeof inspector !== 'string' || !inspector.trim()) {
    return res.status(400).json({
      error: 'invalid_field',
      field: 'inspector',
      message: '巡检人姓名不能为空'
    });
  }

  // Validate note length
  const safeNote = (typeof note === 'string') ? note.slice(0, 1000) : '';

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

// Serve static files (index.html)
app.use(express.static(path.join(__dirname)));

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
