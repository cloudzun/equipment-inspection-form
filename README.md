# 车间设备巡检登记表

手机扫码，填设备状态，管理者按设备/日期/人查历史。替代纸质巡检表。

## 谁用

- **巡检员**（2人）：每天巡检 ~20 台设备。手机扫码 → 选状态 → 填姓名备注 → 提交。30 秒完成一台。
- **管理者**（1人）：打开历史页面，按设备编号、日期、巡检人查记录。

## 怎么部署

服务器是车间内网的一台 Windows 电脑（需装 Node.js）：

```bash
git clone https://github.com/cloudzun/equipment-inspection-form.git
cd equipment-inspection-form
npm install
node server.js
```

服务跑在 `http://服务器IP:3000`。建议用 pm2 管理进程，重启后自动拉起。

## 怎么用

### 巡检员填表

1. 手机扫码（二维码贴在每台设备上）
2. 浏览器打开 `http://服务器IP:3000/?device=设备编号`，设备编号已自动填好
3. 点选设备状态（正常 / 异常 / 待维修）
4. 填巡检人姓名和备注（选填）
5. 点"提交巡检记录" → 看到绿色 ✅ 就是提交成功了

如果二维码花了/脏了扫不了，也可以手动从下拉列表选设备编号。

### 管理者查历史

浏览器打开 `http://服务器IP:3000/?view=history`，可以：
- 按设备编号筛选
- 按巡检人筛选
- 按日期范围筛选

## 文件结构

```
index.html    — 前端页面（表单 + 历史查询），697 行
server.js     — 后端 API + SQLite 数据库，231 行
package.json  — 依赖：express + better-sqlite3
```

## 架构

```
巡检员手机浏览器
  │  POST /api/inspections
  ▼
Express (server.js)
  │  INSERT
  ▼
SQLite WAL (inspections.db)
  │  SELECT
  ▼
管理者浏览器 (历史查询页)
```

## 安全

- 内网信任边界，无需登录
- XSS 防护：使用 `textContent` 渲染，不执行 `<script>`
- CORS 限制：只接受同源请求
- 设备白名单：前端和后端双重校验，只允许已知设备编号
- 速率限制：每个 IP 每分钟最多 100 次请求

## 设计文档

完整设计文档、评审报告、QA 结果在 `.gstack/` 目录下。
