# Superpowers 实验手册

> 日期：2026-06-20 | 项目：equipment-inspection-form

## 概述

本手册记录使用 **Superpowers** 插件完整开发一个功能的全流程：
`brainstorming → spec → writing-plans → worktree → TDD → code-review → finishing`

实验需求：给巡检登记表单加一个功能——同一台设备如果连续两次巡检被标记为"异常"，列表里要把这台设备标红提示。

## 前置准备：取消权限弹窗（自动批准模式）

Superpowers 流程中会频繁调用子代理、写文件、执行命令。如果每次弹窗问权限，流程会被反复打断。**建议一开始就放开权限。**

### 方法：项目级 `settings.json` 全开放

编辑 `{project}/.claude/settings.json`：

```json
{
  "defaultPermissionMode": "bypassPermissions",
  "permissions": {
    "allow": [
      "WebSearch",
      "WebFetch",
      "Skill(*)",
      "Agent(*)",
      "Bash(curl:*)",
      "Bash(git:*)",
      "Bash(node:*)",
      "Bash(npm:*)",
      "Bash(mkdir:*)",
      "Bash(npx:*)",
      "Bash(taskkill:*)",
      "Bash(timeout:*)",
      "Bash(sleep:*)",
      "Edit(C:\path\to\project\*)",
      "Write(C:\path\to\project\*)",
      "Read(C:\path\to\project\*)",
      "Glob(C:\path\to\project\*)",
      "Grep(C:\path\to\project\*)",
      "Bash(C:\path\to\project\*)",
      "Bash"
    ]
  }
}
```

**关键字段：**

| 字段 | 作用 |
|------|------|
| `"defaultPermissionMode": "bypassPermissions"` | **全局跳过权限检查**。所有不在 `deny` 列表里的操作自动批准，不再弹窗 |
| `"permissions.allow"` | 显式白名单。按 `ToolName(pattern)` 格式精确匹配 |

**两种策略：**

| 策略 | 做法 | 适合 |
|------|------|------|
| **bypassPermissions**（推荐） | 全局跳过 + 加白名单兜底 | 个人项目、实验环境 |
| **纯白名单** | 不加 `bypassPermissions`，逐条列 allow | 团队项目、需要审计 |

> **踩坑记录**：我们在本次实验中遇到的最大困扰就是**反复弹窗赋权**——子代理被派发到 worktree 后所有 Write/Bash 都被拒绝，导致流程卡死多次。放上 `bypassPermissions` 后一切顺畅。

---

## Superpowers 完整流程

### 1. brainstorming — 头脑风暴

**作用**：把模糊的想法变成精确的设计需求。

**触发**：
```
/superpowers:brainstorming 我想给巡检登记表单加一个功能：...
```

**过程**：
1. 技能先读代码上下文
2. 逐题提问，一次只问一个（避免信息过载）
3. 提 2-3 个方案，给出推荐
4. 逐段展出设计，每段确认后再继续
5. 写 spec 文件到 `docs/superpowers/specs/YYYY-MM-DD-topic-design.md`
6. commit → user review → 进入下一阶段

**本次实验的决策记录**：

| 问题 | 选择 |
|------|------|
| "连续两次异常"怎么判断？ | A. 只看最近两次 |
| 标红范围？ | A. 只标历史列表 |
| 怎么解除？ | C. 单独告警管理卡片，手动逐个解除 |
| 解除状态怎么存？ | A. 服务端 alerts 表持久化 |

**耗时**：~10 分钟（取决于决策链长度）

---

### 2. spec — 设计文档

brainstorming 结束时自动写好 spec，无需单独操作。

**产出物**：`docs/superpowers/specs/2026-06-20-consecutive-abnormal-alert.md`

**内容包括**：
- 数据模型（alerts 表 schema）
- 后端 API（GET /api/alerts, POST /api/alerts/:id/resolve）
- 前端结构（告警卡片 + 记录标红）
- CSS 样式定义
- 测试验证步骤

---

### 3. writing-plans — 实现计划

**触发**：
```
/superpowers:writing-plans
```

传入 spec 路径和项目背景，生成 bite-sized 实现计划。

**产出物**：`docs/superpowers/plans/2026-06-20-consecutive-abnormal-alert.md`

**计划结构**：7 个 Task，每个包含：
- 修改的文件
- 接口定义（Consumes / Produces）
- 逐步 checklist（写测试 → 验证失败 → 实现 → 验证通过 → commit）
- **每步都有完整代码**（不写 TBD 或 TODO）

| Task | 内容 |
|------|------|
| 1 | 后端 alerts 表 + prepared statements |
| 2 | POST /api/inspections 自动触发告警 |
| 3 | 告警查询和解除 API |
| 4 | 前端 CSS 样式 |
| 5 | 前端 HTML 告警卡片 |
| 6 | 前端 JS 逻辑 |
| 7 | 端到端验证 |

---

### 4. using-git-worktrees — 隔离工作区

**触发**：执行阶段开始时自动触发（由 subagent-driven-development 引导）

**过程**：
```
检测是否已在 worktree → 不在 → 用 EnterWorktree 创建隔离副本
```

本次创建了 `consecutive-abnormal-alert-v2` worktree，所有改动与 master 完全隔离，失败随时丢弃。

---

### 5. TDD — 测试驱动开发

**执行方式**：`/superpowers:subagent-driven-development`（新鲜子代理 + 代码审查每 task）

**实际执行**：由于子代理在 worktree 中遇到权限问题，改为在主会话中按 TDD 节奏手动执行 7 个 task。

**每个 task 的 TDD 三步**：

```
Step 1: 写一个会失败的测试
Step 2: 确认测试失败
Step 3: 写最简代码让测试通过
Step 4: 确认测试通过
Step 5: git commit
```

**示例 — Task 1 的 TDD 过程**：

```bash
# Step 1 & 2: 确认 alerts 表还不存在
$ node -e "const db=require('better-sqlite3')('inspections.db');
  db.prepare('SELECT * FROM alerts').all()"
# FAIL: SqliteError: no such table: alerts

# Step 3: 写入 alerts 表 schema + prepared statements 到 server.js

# Step 4: 确认 alerts 表已创建
$ node -e "..."
# PASS: alerts table EXISTS, idx_alerts_active EXISTS

# Step 5: git commit
```

**本次验证数据**：

| 测试场景 | 预期 | 结果 |
|----------|------|------|
| 1 条异常 → 不触发告警 | alerts count = 0 | PASS |
| 2 条异常 → 触发告警 | alerts count = 1 | PASS |
| 3 条异常 → 不重复 | active alerts = 1 | PASS |
| 异常+正常 → 不触发 | shadds-02 不在 alerts 中 | PASS |
| 解除 → 再 2 条异常 → 重新触发 | alerts 重新出现 | PASS |
| 解除不存在的告警 | 404 | PASS |
| 解除时无 resolved_by | 400 | PASS |

---

### 6. requesting-code-review — 代码审查

**触发**：全部 task 完成后

**过程**：
1. 运行 `scripts/review-package BASE HEAD` 生成完整 diff 文件
2. 按 `code-reviewer.md` 模板派发 **Sonnet** 子代理审查
3. 审查维度：plan 对齐、代码质量、架构、测试、生产就绪

**本次审查结果**：

| 级别 | 数量 | 内容 |
|------|------|------|
| Critical | 0 | - |
| Important | 1 | `data-device` 上不应使用 `escHtml()`（但当前值安全） |
| Minor | 2 | 非活跃查询可缓存；`parseInt` NaN guard |

**结论**：**Ready to Merge** ✅

---

### 7. finishing-a-development-branch — 合并收尾

**触发**：
```
/superpowers:finishing-a-development-branch
```

**过程**：
1. 检测环境（确认在 named-branch worktree）
2. 提供 4 个选项
3. 选 1（合并回 master）
4. `git checkout master && git merge worktree-xxx`
5. smoke test（`node server.js` 启动验证）
6. 删除 worktree + 分支
7. 确认 `git worktree list` 干净

---

## 完整流程总结

```
用户的模糊想法
    ↓
brainstorming (10 min)     ← 逐题问答，确定精确需求
    ↓
spec (自动写入)            ← 设计文档
    ↓
writing-plans              ← bite-size 实现计划，每步有完整代码
    ↓
using-git-worktrees        ← 隔离工作区
    ↓
TDD × 7 tasks              ← 红-绿-重构，每 task 独立 commit
    ↓
requesting-code-review     ← Sonnet 审查 diff + spec 对齐
    ↓
finishing                  ← 合并 + 清理
    ↓
✅ 功能合入 master
```

## 关键踩坑与经验

### 1. 权限是第一道坎

Superpowers 流程会大量使用子代理——子代理在隔离 worktree 中无法继承主会话的权限，必须**提前在 settings.json 中配好 `bypassPermissions`**。否则每个 task 都会卡在"Write denied / Bash denied"。

### 2. 子代理 vs 主会话执行

子代理 (`Agent` tool) 适合：
- 独立 task，1-2 文件修改
- 需要隔离上下文的场景

主会话直接执行适合：
- 多文件联动修改
- 需要上下文连续性的操作（curl 验证、git 操作）

本次实验中，我们最终在主会话中以 TDD 节奏手动执行了全部 task，避免了子代理权限问题。

### 3. worktree 清理

合并后注意：
- 先 `cd` 到主仓库再 `git worktree remove`
- worktree 目录可能被锁定（Permission denied），手工 `rm -rf` 即可
- 用 `ExitWorktree` 工具切换回主仓库

### 4. 完整越久越好

每个环节的产出物都持久化到 `docs/superpowers/` 下，方便后续回顾和审计。

## 生成文件清单

```
docs/superpowers/
├── specs/2026-06-20-consecutive-abnormal-alert.md      ← 设计文档
├── plans/2026-06-20-consecutive-abnormal-alert.md      ← 实现计划
└── lab-guide.md                                        ← 本手册
```
