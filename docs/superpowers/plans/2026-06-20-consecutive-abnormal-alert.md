# 设备连续异常标红提示 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一台设备连续两次巡检为"异常"时，历史列表标红 + 页面顶部告警卡片，支持手动解除。

**Architecture:** 后端新增 `alerts` 表 + 两个告警 API，修改 `POST /api/inspections` 在提交后自动检测连续异常并插入告警。前端新增告警卡片 HTML/CSS，修改 `searchHistory()` 并行获取告警列表并在记录行标红，告警卡片支持点击解除。

**Tech Stack:** Express 4.x + better-sqlite3 11.x + vanilla HTML/CSS/JS (IndexedDB)

## Global Constraints

- 前后端 DEVICE_LIST 保持现有约定
- 文本编码/长度限制沿用现有校验规则
- 移动端优先，不破坏现有响应式布局
- 新 API 不改变现有 `/api/inspections` 的 GET/POST 行为
- 无测试框架，用 curl 命令 + 浏览器手动验证

---

### Task 1: 后端 — alerts 表 + prepared statements

**Files:**
- Modify: `server.js:26-42` (db.exec schema block)
- Modify: `server.js:46-68` (prepared statements block)

**Interfaces:**
- Produces:
  - `stmtCheckConsecutive` — prepared: `(device_id) => [{id, device_id, status, rn}]`
  - `stmtCheckActiveAlert` — prepared: `(device_id) => {id} | undefined`
  - `stmtInsertAlert` — prepared: `(device_id, triggered_inspection_id) => RunResult`
  - `stmtQueryAlerts` — prepared: `() => [{id, device_id, created_at, status, inspector, note, triggered_at}]`
  - `stmtResolveAlert` — prepared: `(resolved_by, id) => RunResult`

- [ ] **Step 1: 在 db.exec 中新增 alerts 表**

将 `server.js` 第 26-42 行的 `db.exec()` 调用替换为：

```js
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
```

- [ ] **Step 2: 新增 prepared statements**

在 `server.js` 第 67 行 `stmtQueryCountDevice` 定义之后、第 70 行 `// --- Express app ---` 注释之前，插入：

```js
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
```

- [ ] **Step 3: 启动服务确认 schema 生效**

```bash
node server.js
# 预期：无报错，输出 "SQLite WAL mode ready, schema ensured."
# Ctrl+C 退出
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add alerts table and prepared statements"
```

---

### Task 2: 后端 — POST /api/inspections 自动触发告警

**Files:**
- Modify: `server.js:160-182` (try block in POST handler)

**Interfaces:**
- Consumes: `stmtCheckConsecutive`, `stmtCheckActiveAlert`, `stmtInsertAlert` (from Task 1)
- Produces: auto-inserted `alerts` rows when consecutive abnormal detected

- [ ] **Step 1: 在 POST handler 中插入成功响应后添加告警检测**

在 `server.js` 中，找到 `POST /api/inspections` 的 try 块（第 160 行起），在 `res.status(201).json(...)` 调用之后、`} catch (err) {` 之前，插入告警检测逻辑。完整的 try 块变为：

```js
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

    // Auto-trigger alert: check if last 2 inspections for this device are both "异常"
    const recentTwo = stmtCheckConsecutive.all(device_id);
    if (recentTwo.length === 2 && recentTwo.every(r => r.status === '异常')) {
      const existingAlert = stmtCheckActiveAlert.get(device_id);
      if (!existingAlert) {
        // recentTwo[0] has rn=1, which is the most recent (just inserted)
        stmtInsertAlert.run(device_id, recentTwo[0].id);
      }
    }

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
```

- [ ] **Step 2: 用 curl 验证告警触发**

```bash
# 启动服务
node server.js &
sleep 1

# 对 shadds-01 提交第一条异常
curl -s -X POST http://localhost:3000/api/inspections \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"shadds-01","status":"异常","inspector":"测试员","note":"异响","client_created_at":"2026-06-20T10:00:00.000Z"}'
# 预期: {"id":...,"created_at":"..."}

# 此时告警不应触发（只有一条）
sqlite3 inspections.db "SELECT * FROM alerts;"
# 预期: 空（无输出）

# 对 shadds-01 提交第二条异常
curl -s -X POST http://localhost:3000/api/inspections \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"shadds-01","status":"异常","inspector":"测试员","note":"","client_created_at":"2026-06-20T11:00:00.000Z"}'

# 此时应触发告警
sqlite3 inspections.db "SELECT id, device_id, triggered_inspection_id, resolved_at FROM alerts;"
# 预期: 1|shadds-01|<inspection_id>|

# 再提交一条异常 — 不应重复创建告警（已有未解除的）
curl -s -X POST http://localhost:3000/api/inspections \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"shadds-01","status":"异常","inspector":"测试员","note":"","client_created_at":"2026-06-20T12:00:00.000Z"}'

sqlite3 inspections.db "SELECT COUNT(*) FROM alerts WHERE resolved_at IS NULL;"
# 预期: 1

kill %1 2>/dev/null
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: auto-trigger alert on consecutive abnormal inspections"
```

---

### Task 3: 后端 — GET /api/alerts 和 POST /api/alerts/:id/resolve

**Files:**
- Modify: `server.js:241-243` (before `// Serve static files` comment)

**Interfaces:**
- Consumes: `stmtQueryAlerts`, `stmtResolveAlert` (from Task 1)
- Produces:
  - `GET /api/alerts?status=active` → `{ alerts: [{ id, device_id, created_at, status, inspector, note, triggered_at }] }`
  - `POST /api/alerts/:id/resolve` ← `{ resolved_by }` → `{ id, device_id, resolved_at }`

- [ ] **Step 1: 新增两个告警 API 路由**

在 `server.js` 第 241 行 `// Serve static files` 注释之前插入：

```js
// GET /api/alerts — list alerts, optional ?status=active for unresolved
app.get('/api/alerts', (req, res) => {
  const { status } = req.query;
  try {
    let alerts;
    if (status === 'active') {
      alerts = stmtQueryAlerts.all();
    } else {
      alerts = db.prepare(`
        SELECT a.id, a.device_id, a.created_at, a.resolved_at, a.resolved_by,
          i.status, i.inspector, i.note, i.created_at as triggered_at
        FROM alerts a
        JOIN inspections i ON i.id = a.triggered_inspection_id
        ORDER BY a.created_at DESC
      `).all();
    }
    res.json({ alerts });
  } catch (err) {
    console.error('Alerts query error:', err.message);
    res.status(500).json({ error: 'internal_error', message: '服务器内部错误，请重试' });
  }
});

// POST /api/alerts/:id/resolve — mark an alert as resolved
app.post('/api/alerts/:id/resolve', (req, res) => {
  const id = parseInt(req.params.id);
  const { resolved_by } = req.body;

  if (!resolved_by || typeof resolved_by !== 'string' || !resolved_by.trim()) {
    return res.status(400).json({
      error: 'invalid_field',
      field: 'resolved_by',
      message: '解除人姓名不能为空'
    });
  }

  try {
    const result = stmtResolveAlert.run(resolved_by.trim(), id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'not_found', message: '告警记录不存在或已解除' });
    }
    const row = db.prepare('SELECT id, device_id, resolved_at FROM alerts WHERE id = ?').get(id);
    res.json(row);
  } catch (err) {
    console.error('Resolve alert error:', err.message);
    res.status(500).json({ error: 'internal_error', message: '服务器内部错误，请重试' });
  }
});
```

- [ ] **Step 2: 用 curl 验证两个 API**

```bash
node server.js &
sleep 1

# 先触发一个告警（提交两条异常）
curl -s -X POST http://localhost:3000/api/inspections \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"shadds-05","status":"异常","inspector":"测试员","note":"","client_created_at":"2026-06-20T10:00:00.000Z"}'
curl -s -X POST http://localhost:3000/api/inspections \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"shadds-05","status":"异常","inspector":"测试员","note":"震动","client_created_at":"2026-06-20T11:00:00.000Z"}'

# 查询告警列表
curl -s http://localhost:3000/api/alerts?status=active
# 预期: {"alerts":[{"id":...,"device_id":"shadds-05","created_at":"...","status":"异常","inspector":"测试员","note":"震动","triggered_at":"..."}]}

# 解除告警
curl -s -X POST http://localhost:3000/api/alerts/1/resolve \
  -H 'Content-Type: application/json' \
  -d '{"resolved_by":"张三"}'
# 预期: {"id":1,"device_id":"shadds-05","resolved_at":"2026-06-20 ..."}

# 再次查询应返回空
curl -s http://localhost:3000/api/alerts?status=active
# 预期: {"alerts":[]}

# 解除不存在的告警
curl -s -X POST http://localhost:3000/api/alerts/999/resolve \
  -H 'Content-Type: application/json' \
  -d '{"resolved_by":"张三"}'
# 预期: {"error":"not_found","message":"告警记录不存在或已解除"}

kill %1 2>/dev/null
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add GET /api/alerts and POST /api/alerts/:id/resolve endpoints"
```

---

### Task 4: 前端 — CSS 样式

**Files:**
- Modify: `index.html:136-138` (在 `/* ===== Utility ===== */` 之前插入)

**Interfaces:**
- Produces: CSS classes `.alert-card`, `.alert-card-title`, `.alert-card-item`, `.alert-card-device`, `.alert-resolve-btn`, `.record-item.alert-device`

- [ ] **Step 1: 在 index.html CSS 中插入告警相关样式**

在 `index.html` 的 `/* ===== Utility ===== */` 行（约第 137 行）之前插入：

```css
/* ===== Alert Card ===== */
.alert-card {
  background: #fff0f0; border: 1px solid #f5c6cb; border-radius: 10px;
  padding: 14px 16px; margin-bottom: 16px;
}
.alert-card-title { font-weight: 600; color: #c62828; margin-bottom: 10px; font-size: .95rem; }
.alert-card-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 0;
  border-bottom: 1px solid #f5c6cb; font-size: .88rem; flex-wrap: wrap;
}
.alert-card-item:last-child { border-bottom: none; }
.alert-card-device { font-weight: 600; color: #1a73e8; min-width: 90px; }
.alert-resolve-btn {
  margin-left: auto; padding: 4px 14px; font-size: .82rem; background: #e53935;
  color: #fff; border: none; border-radius: 6px; cursor: pointer;
  font-family: inherit; transition: background .15s;
  -webkit-tap-highlight-color: transparent;
}
.alert-resolve-btn:active { transform: scale(.97); }

/* Record row alert highlight */
.record-item.alert-device {
  background: #fff0f0; border-left: 4px solid #e53935;
  padding-left: 16px; border-radius: 0 6px 6px 0;
}
```

- [ ] **Step 2: 启动服务确认样式不破坏页面**

```bash
node server.js &
sleep 1
```

浏览器打开 `http://localhost:3000`，确认填表页面样式正常。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "style: add alert card and highlight CSS"
```

---

### Task 5: 前端 — HTML 告警卡片结构

**Files:**
- Modify: `index.html:196-215` (在 `#view-history` 内的 query-bar 下方)

**Interfaces:**
- Produces: `<div id="alert-card">` with `<div id="alert-list">` children

- [ ] **Step 1: 在历史视图的查询栏下方插入告警卡片 div**

在 `index.html` 的 `#view-history` 内，`query-bar` 的 `</div>` 之后、`<div id="sync-badge"` 之前，插入：

```html
        <div id="alert-card" class="alert-card hidden">
          <div class="alert-card-title">⚠️ 告警设备（连续两次异常）</div>
          <div id="alert-list"></div>
        </div>
```

最终该区域的 HTML 结构如下：

```html
    <div class="card">
      <div class="query-bar">
        ...
      </div>
      <div id="alert-card" class="alert-card hidden">
        <div class="alert-card-title">⚠️ 告警设备（连续两次异常）</div>
        <div id="alert-list"></div>
      </div>
      <div id="sync-badge" class="text-center text-muted" style="margin-bottom:12px;display:none;"></div>
      <ul class="record-list" id="record-list"></ul>
      <div class="empty-state hidden" id="empty-history">暂无记录</div>
    </div>
```

- [ ] **Step 2: 刷新浏览器确认无 JS 报错**

`node server.js` 后打开 `http://localhost:3000` → 切到"查历史"，确认页面结构正常，`alert-card` 为 `hidden` 状态。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add alert card HTML in history view"
```

---

### Task 6: 前端 — JS 逻辑（获取/渲染告警 + 标红 + 解除）

**Files:**
- Modify: `index.html:581-633` (searchHistory 函数)
- Modify: `index.html:648` 附近 (在 formatTime 之后插入新函数)
- Modify: `index.html:673-698` (DOMContentLoaded init block)

**Interfaces:**
- Consumes: `GET /api/alerts?status=active`, `POST /api/alerts/:id/resolve`, `$()`, `escHtml()`, `formatTime()`, `statusClass()`
- Produces: `renderAlertCard(alerts)`, modified `searchHistory()` with alert integration, alert list click delegation

- [ ] **Step 1: 新增 renderAlertCard 函数**

在 `index.html` 的 `formatTime` 函数定义之后（第 647 行后）、`// ===== Navigation =====` 注释之前，插入：

```js
// ============================================================
// Alert card rendering
// ============================================================
function renderAlertCard(alerts) {
  const card = $('#alert-card');
  const list = $('#alert-list');

  if (!alerts || alerts.length === 0) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  list.innerHTML = alerts.map(a => `
    <div class="alert-card-item">
      <span class="alert-card-device">${escHtml(a.device_id)}</span>
      <span>${escHtml(a.inspector)}</span>
      <span style="color:#888;font-size:.8rem;">触发: ${escHtml(formatTime(a.triggered_at))}</span>
      ${a.note ? `<span style="color:#888;font-size:.82rem;">${escHtml(a.note)}</span>` : ''}
      <button class="alert-resolve-btn" data-alert-id="${a.id}" data-device="${escHtml(a.device_id)}">解除</button>
    </div>
  `).join('');
}
```

- [ ] **Step 2: 重写 searchHistory 函数以整合告警**

将 `index.html` 中现有的 `searchHistory` 函数（第 584-633 行）整体替换为：

```js
async function searchHistory() {
  const params = new URLSearchParams();
  const device = $('#q-device').value;
  const inspector = $('#q-inspector').value.trim();
  const dateFrom = $('#q-date-from').value;
  const dateTo = $('#q-date-to').value;

  if (device) params.set('device_id', device);
  if (inspector) params.set('inspector', inspector);
  if (dateFrom) params.set('date_from', dateFrom + 'T00:00:00');
  if (dateTo) params.set('date_to', dateTo + 'T23:59:59');
  params.set('limit', '200');

  const list = $('#record-list');
  const empty = $('#empty-history');
  list.innerHTML = '';

  try {
    const [resp, alertsResp] = await Promise.all([
      fetch(`${API_BASE}?${params.toString()}`),
      fetch('/api/alerts?status=active')
    ]);

    // Render alert card from alerts response
    let alertDevices = new Set();
    if (alertsResp.ok) {
      const alertsData = await alertsResp.json();
      renderAlertCard(alertsData.alerts);
      alertsData.alerts.forEach(a => alertDevices.add(a.device_id));
    } else {
      renderAlertCard([]);
    }

    if (!resp.ok) throw new Error('Server error');
    const data = await resp.json();

    if (data.records.length === 0) {
      empty.classList.remove('hidden');
      list.innerHTML = '';
      return;
    }

    empty.classList.add('hidden');
    data.records.forEach(r => {
      const sc = statusClass(r.status);
      const isAlert = alertDevices.has(r.device_id);
      const li = document.createElement('li');
      li.className = 'record-item' + (isAlert ? ' alert-device' : '');
      li.innerHTML = `
        <div class="record-header">
          <span class="record-device">${escHtml(r.device_id)}</span>
          <span class="record-time">${escHtml(formatTime(r.created_at))}</span>
        </div>
        <div class="record-detail">
          <span class="record-status ${sc}">${escHtml(r.status)}</span>
          &nbsp;${escHtml(r.inspector)}${r.note ? ' · ' + escHtml(r.note) : ''}
        </div>
      `;
      list.appendChild(li);
    });
  } catch (err) {
    empty.classList.remove('hidden');
    empty.textContent = '查询失败：' + err.message;
  }
}
```

- [ ] **Step 3: 在 DOMContentLoaded 中添加告警解除的事件委托**

在 `index.html` 的 `DOMContentLoaded` 回调中（第 676 行起）、`showView(...)` 调用之前（或之后任意位置），插入：

```js
  // Alert resolve button delegation
  $('#alert-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.alert-resolve-btn');
    if (!btn) return;

    const alertId = btn.dataset.alertId;
    const deviceName = btn.dataset.device;
    const name = prompt(`解除设备 ${deviceName} 的告警，请输入您的姓名：`);
    if (!name || !name.trim()) return;

    btn.disabled = true;
    btn.textContent = '解除中...';

    try {
      const resp = await fetch(`/api/alerts/${alertId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved_by: name.trim() })
      });
      if (resp.ok) {
        searchHistory(); // Refresh both alert card and record list
      } else {
        const err = await resp.json();
        alert(err.message || '解除失败，请重试');
        btn.disabled = false;
        btn.textContent = '解除';
      }
    } catch (err) {
      alert('网络错误：' + err.message);
      btn.disabled = false;
      btn.textContent = '解除';
    }
  });
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: integrate alert card rendering, row highlight, and resolve logic"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 启动服务**

```bash
node server.js
```

- [ ] **Step 2: 测试告警触发**

浏览器打开 `http://localhost:3000`：

1. 选择设备 `shadds-01`，状态选"异常"，巡检人填"张三"，提交
2. 再提交一次 `shadds-01` + "异常"（巡检人不限）
3. 切换到"查历史"标签
4. **确认** 顶部出现红色告警卡片：`⚠️ 告警设备（连续两次异常）` → `shadds-01 张三 触发: ... [解除]`
5. **确认** `shadds-01` 所有记录行背景为 `#fff0f0`，左侧有 4px 红色边框

- [ ] **Step 3: 测试非连续异常不触发**

1. 选择 `shadds-02`，提交"异常"→"正常"
2. 切到"查历史"：确认告警卡片中没有 `shadds-02`

- [ ] **Step 4: 测试解除告警**

1. 点击 `shadds-01` 旁边的"解除"按钮
2. 输入姓名"李四"，确认
3. **确认** 告警卡片中 `shadds-01` 消失
4. **确认** 记录列表中 `shadds-01` 的红色标红消失
5. 如果只剩一个告警设备也会消失，则整个告警卡片隐藏

- [ ] **Step 5: 测试解除后重新触发**

1. 对 `shadds-01` 再次连续提交两条"异常"
2. 切到"查历史"
3. **确认** 告警卡片重新出现 `shadds-01`

- [ ] **Step 6: 测试重复告警不创建**

1. `shadds-01` 已有未解除告警时，再提交一条"异常"
2. 用 curl 确认：

```bash
curl -s http://localhost:3000/api/alerts?status=active | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([a for a in d['alerts'] if a['device_id']=='shadds-01']))"
# 预期: 1
```

- [ ] **Step 7: 记录验证结果**

记录截图或验证通过的标准输出。

---

## Self-Review

**1. Spec coverage:**
- ✅ alerts 表 → Task 1
- ✅ GET /api/alerts?status=active → Task 3
- ✅ POST /api/alerts/:id/resolve → Task 3
- ✅ POST /api/inspections 自动触发 → Task 2
- ✅ 告警卡片 → Task 4 + 5 + 6
- ✅ 记录行标红 → Task 4 + 6
- ✅ 解除交互 → Task 6
- ✅ 重复告警不创建 → Task 2 (stmtCheckActiveAlert guard)

**2. Placeholder scan:** 无 TBD/TODO/占位符。所有代码步骤包含完整可运行代码。

**3. Type consistency:**
- `stmtQueryAlerts.all()` 返回数组 → `renderAlertCard(alerts)` 消费 `.map()` → 一致 ✅
- `alertDevices` 为 `Set<string>` → `alertDevices.has(r.device_id)` → 一致 ✅
- `data-alert-id` / `data-device` → `btn.dataset.alertId` / `btn.dataset.device` → 一致 ✅（camelCase 是 dataset API 约定）
