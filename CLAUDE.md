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

2026-06-20:
- /autoplan — CEO review (5 findings) + Eng review (13 findings). Design doc updated with audit trail + review report.
- /review — 18 adversarial findings, 12 fixed. Files: server.js, index.html, .gitignore
- /qa — health score 92/100, core flows verified, ISSUE-001 (?view=history routing) fixed

## Spec

2026-06-20: /spec - 14/14 quality standards passed. Spec archived at ~/.gstack/projects/equipment-inspection-form/specs/

## Design Doc

2026-06-20: /office-hours → design doc at ~/.gstack/projects/equipment-inspection-form/cheng-master-design-20260620-090909.md

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
