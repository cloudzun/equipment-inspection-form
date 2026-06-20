# 设备连续异常标红提示 — 设计文档

> 日期: 2026-06-20 | 状态: approved

## 概述

同一台设备如果连续两次巡检被标记为"异常"，在历史记录列表中把该设备行标红，并在页面顶部显示告警卡片，支持手动解除告警。

## 数据模型

### 新表 `alerts`

```sql
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
```

- 同一设备同时最多一条未解除告警（`idx_alerts_active` 保证）
- `resolved_at` 为 NULL 表示告警未解除
- 解除时写入 `resolved_at` 和 `resolved_by`

## 后端 API

### 新增 `GET /api/alerts?status=active`

返回未解除的告警列表。

**Response (200):**
```json
{
  "alerts": [
    {
      "id": 1,
      "device_id": "shadds-03",
      "triggered_at": "2026-06-20 10:30:00",
      "status": "异常",
      "inspector": "张三",
      "note": "异响"
    }
  ]
}
```

`triggered_at` 为触发告警的那条巡检记录的 `created_at`。附带最近一条异常记录的 `status`、`inspector`、`note`。

**Response (500):** `{ "error": "internal_error", "message": "服务器内部错误，请重试" }`

### 新增 `POST /api/alerts/:id/resolve`

解除一条告警。

**Request body:**
```json
{ "resolved_by": "张三" }
```

**Response (200):**
```json
{ "id": 1, "device_id": "shadds-03", "resolved_at": "2026-06-20 11:00:00" }
```

### 修改 `POST /api/inspections`

插入新记录成功后，检查该设备最近两条是否都为"异常"：

```sql
WITH ranked AS (
  SELECT id, device_id, status
    ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY created_at DESC) as rn
  FROM inspections
  WHERE device_id = ?
)
SELECT * FROM ranked WHERE rn <= 2
```

若最近两条都是"异常"且 `alerts` 中该设备没有未解除记录 → `INSERT INTO alerts (device_id, triggered_inspection_id)`。

验证规则和速率限制沿用现有逻辑。

## 前端

### 新区域：告警卡片（"查历史"页面，查询栏下方、记录列表上方）

有未解除告警时显示：

```
┌─────────────────────────────────────────────────┐
│ ⚠️ 告警设备（连续两次异常）                       │
│                                                 │
│ shadds-03  张三  触发: 06-20 10:30  异响  [解除]  │
│ shadds-07  李四  触发: 06-20 09:15  震动  [解除]  │
└─────────────────────────────────────────────────┘
```

- 无告警 → 隐藏
- 点击"解除" → 弹出确认对话框 → 输入解除人姓名 → `POST /api/alerts/:id/resolve` → 刷新列表

### 修改：记录列表标红

`searchHistory()` 中 `Promise.all` 同时获取记录列表和告警列表，对 `alertDevices` 集合中的设备行添加 CSS class `alert-device`。

### 新增 CSS

```css
/* Alert Card */
.alert-card {
  background: #fff0f0; border: 1px solid #f5c6cb; border-radius: 10px;
  padding: 14px 16px; margin-bottom: 16px;
}
.alert-card-title { font-weight: 600; color: #c62828; margin-bottom: 10px; font-size: .95rem; }
.alert-card-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 0;
  border-bottom: 1px solid #f5c6cb; font-size: .88rem;
}
.alert-card-item:last-child { border-bottom: none; }
.alert-card-device { font-weight: 600; color: #1a73e8; min-width: 90px; }
.alert-resolve-btn {
  margin-left: auto; padding: 4px 14px; font-size: .82rem; background: #e53935;
  color: #fff; border: none; border-radius: 6px; cursor: pointer;
  font-family: inherit; transition: background .15s;
}
.alert-resolve-btn:active { transform: scale(.97); }

/* Record row alert highlight */
.record-item.alert-device {
  background: #fff0f0; border-left: 4px solid #e53935;
  padding-left: 16px; border-radius: 0 6px 6px 0;
}
```

### 动态刷新

- 切换到"查历史"标签 → 自动拉取告警列表 + 记录列表
- 点击"解除"成功后 → 刷新告警卡片和记录列表
- 提交新巡检记录后 → 不做任何操作（用户切换到查历史时自然刷新）

## 测试验证

1. 启动 `node server.js`
2. 对 `shadds-01` 连续提交 2 条"异常" → 切换到"查历史" → 确认告警卡片出现且该设备记录标红
3. 对 `shadds-02` 提交"异常"→"正常" → 确认不触发告警
4. 点击"解除"按钮 → 输入姓名 → 确认告警卡片中该设备消失，记录标红消失
5. 对已解除的 `shadds-01` 再次连续 2 条"异常" → 确认重新出现告警
6. `curl http://localhost:3000/api/alerts?status=active` 确认 API 正确返回
