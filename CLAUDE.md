## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).

## Write Targets — 技能 → 写入位置 映射

| 技能 | 写入目标 | 写入内容 |
|------|---------|---------|
| /office-hours | ~/.gstack/projects/SLUG/*-design-*.md | Design doc (problem, premises, approaches) |
| /autoplan | ~/.gstack/projects/SLUG/*-design-*.md (追加) | Audit trail + architecture updates + review report |
| | ~/.gstack/projects/SLUG/*-reviews.jsonl | Structured review logs (gstack-review-log) |
| /spec | ~/.gstack/projects/SLUG/specs/*.md | Spec archive (schema, API, acceptance criteria) |
| /review | Source code | Security/bug fixes (committed) |
| | ~/.gstack/projects/SLUG/*-reviews.jsonl | Review log with findings + fix actions |
| | CLAUDE.md | Session summary |
| /qa | .gstack/qa-reports/ | QA report + baseline.json + screenshots |
| | ~/.gstack/projects/SLUG/*-test-*.md | Project-scoped test outcome |
| | ~/.gstack/projects/SLUG/*-reviews.jsonl | QA log entry |
| | Source code | Bug fixes (committed) |
| | CLAUDE.md | Session summary |

**Key Commands:**
- `gstack-review-read` — 读取所有评审记录
- `ls .gstack/qa-reports/` — 查看 QA 报告和截图

## Review & QA Logs

### 2026-06-20 — 设备巡检登记表 v1

| 时间 | 技能 | 结果 | 详情 |
|------|------|------|------|
| 09:20 | /office-hours | 设计文档已批准 | 3个前提确认，方案 A + sync 选定 |
| 09:35 | /autoplan | CEO + Eng 评审通过 | CEO 5发现，Eng 13发现。见设计文档 ## GSTACK REVIEW REPORT |
| 09:39 | /spec | 规格归档 | 14/14 质量门通过。见 `specs/20260620-093301-1692--v1.md` |
| 09:42 | 写代码 | feat commit | server.js (231行) + index.html (697行) + package.json |
| 09:49 | /review | 12项修复 | 18项对抗性发现，12项自动修复（commit `c09199a`） |
| 09:54 | /qa | 健康分 92 | 14项测试通过，1项bug修复（commit `3a78c95`） |

**修复详情：**

/review 修复（commit `c09199a`）：
- CORS 通配符 → 显式 origin 策略
- express.static 暴露源码 → 仅显式提供 index.html  
- HOST 默认 0.0.0.0 → 127.0.0.1
- 巡检人姓名加格式校验 + 50字符上限
- note 截断 Unicode 安全
- 服务器端加唯一性约束防重复
- IndexedDB 写入和 fetch 间 race condition 修复
- retry 去重键加 status 字段
- retry 循环断点修复
- formatTime 时区处理修复
- API 速率限制
- .gitignore 加 package-lock.json

/qa 修复（commit `3a78c95`）：
- `?view=history` 直接导航不自动切换到历史视图

/qa 遗留（低优先级）：
- 状态药丸缺少 ARIA 角色（无障碍）
- 历史页初始化时偶发 500（浏览器重试瞬态）

**制品位置：**
- 设计文档：`~/.gstack/projects/equipment-inspection-form/cheng-master-design-20260620-090909.md`
- 规格归档：`~/.gstack/projects/equipment-inspection-form/specs/20260620-093301-1692--v1.md`
- QA 报告：`.gstack/qa-reports/qa-report-localhost-2026-06-20.md`
- 评审日志：`gstack-review-read` 可查 6 条记录

## Deployment

部署到车间 Windows 服务器：

```bash
git clone https://github.com/cloudzun/equipment-inspection-form.git
cd equipment-inspection-form
npm install
node server.js
```

然后生成二维码贴到设备上（每台设备的 URL: `http://服务器IP:3000/?device=设备编号`）。

待确认：车间真实设备编号列表（替换当前示例的 shadds-01~20）。

## Spec

2026-06-20: /spec — 14/14 quality standards passed
文件路径: ~/.gstack/projects/equipment-inspection-form/specs/20260620-093301-1692--v1.md
内容: 完整 schema (SQL DDL), API contract (POST/GET), 表单验证规则, 安全措施,
11 条验收标准, 测试计划, 部署步骤, Out of Scope 列表

2026-06-20: /document-release — 新建 README.md（项目简介、部署、用法、架构、安全）

## Design Doc

2026-06-20: /office-hours — 设计文档 + /autoplan 追加评审报告
文件路径: ~/.gstack/projects/equipment-inspection-form/cheng-master-design-20260620-090909.md
内容: Problem Statement, 3个前提, 3个方案对比 (A/B/C), 推荐方案 A + sync,
Architecture Updates from /autoplan (P0/P1/P2/P3), Decision Audit Trail (16条),
GSTACK REVIEW REPORT (CEO 5发现 + Eng 13发现)

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
