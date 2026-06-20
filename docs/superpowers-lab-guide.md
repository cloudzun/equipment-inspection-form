# Superpowers 完整流程演练指南

> 适用：Claude Code 用户 | 前提：已安装 superpowers 插件

## 这个指南做什么

手把手教你怎么用 Superpowers 的 7 个技能，把一个模糊想法走完完整开发流程：
`brainstorming → spec → writing-plans → worktree → TDD → code-review → finishing`

## 第零步：开放权限（1 分钟）

Superpowers 流程中 Claude 会频繁写文件、执行命令、派发子代理。如果不提前放开权限，**每步都会弹窗问你**，流程会被反复打断。所以第一步就搞定权限。

打开项目下的 `.claude/settings.json`（一般在 `<项目根>/.claude/settings.json`），写入：

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
      "Edit(C:\你的项目路径\*)",
      "Write(C:\你的项目路径\*)",
      "Read(C:\你的项目路径\*)",
      "Glob(C:\你的项目路径\*)",
      "Grep(C:\你的项目路径\*)",
      "Bash(C:\你的项目路径\*)",
      "Bash"
    ]
  }
}
```

**关键**：`"defaultPermissionMode": "bypassPermissions"` 这一行是核心——它告诉 Claude Code 跳过权限检查，除非操作命中显式的 `deny` 列表。没有这一行，即使你列了 100 条 `allow`，新出现的工具调用仍会弹窗。

> 如果你的项目路径是 `C:\Users\jack\my-app`，就把上面的路径替换成 `"Edit(C:\Users\jack\my-app\*)"`。

---

## 第一步：brainstorming（头脑风暴）

**干什么**：把模糊想法变成精确的设计需求。

**怎么用**：在对话中输入：
```
/superpowers:brainstorming 我想给巡检表单加一个功能：同一台设备连续两次异常就标红
```

**会发生什么**：
1. Claude 先阅读你的项目代码，了解当前结构
2. **一次只问一个问题**，用选择题的方式让你选
3. 问你 3-6 个问题，逐步缩窄需求范围
4. 提出 2-3 个实现方案，给出推荐
5. 逐段展出设计，你确认一段再继续下一段
6. 最后自动写 spec 文件并 commit

**你应该做什么**：
- 如实回答每个问题（A/B/C 选一个）
- 看不懂的选项让 Claude 解释
- 确认每段设计后再说"可以"或提出修改
- 最后 Claude 会让你审阅 spec 文件

**产出物**：`docs/superpowers/specs/YYYY-MM-DD-功能名-design.md`

---

## 第二步：spec（设计文档）

**干什么**：brainstorming 自动生成设计文档，你可以在这里审阅修改。

**文件结构**：
```markdown
# 功能名称 — 设计文档
## 概述
## 数据模型
## 后端 API
## 前端
## 测试验证
```

**你要做什么**：
- 通读一遍，确认数据表字段、API 请求/响应格式、前端交互是否跟自己想的一样
- 有歧义的地方告诉 Claude 修改
- 确认后说"没问题"或"可以继续"

---

## 第三步：writing-plans（实现计划）

**干什么**：把 spec 拆成 bite-size 的任务列表，每个任务包含完整代码。

**怎么用**：
```
/superpowers:writing-plans
```

并告诉 Claude spec 文件在哪、项目框架是什么。

**会发生什么**：
1. Claude 读完 spec，设计每个任务的接口和文件边界
2. 输出 5-10 个 Task，每个 Task 里有：
   - 改哪些文件
   - 接口定义（Consumes / Produces）
   - 逐步 checklist：`[ ] 写测试 → [ ] 验证失败 → [ ] 实现 → [ ] 验证通过 → [ ] commit`
   - **每一步都是完整代码**，没有 TBD 或 TODO

**产出物**：`docs/superpowers/plans/YYYY-MM-DD-功能名.md`

**看完后的选择**：Claude 会问你要 Subagent-Driven 还是 Inline Execution，选 Subagent-Driven（推荐）。

---

## 第四步：using-git-worktrees（隔离工作区）

**干什么**：在独立分支上开发，不影响 master。

**这一步是自动的**——当你选 Subagent-Driven 后，Claude 会自动：
1. 检测你是否在 worktree 中
2. 如果没有，创建 `{项目}/.claude/worktrees/{功能名}` 隔离环境
3. 执行 `npm install`
4. 跑 baseline 测试确认环境干净

**你要做什么**：不需要任何操作，这是全自动的。

---

## 第五步：TDD 执行（Task 逐个实现）

**干什么**：按 writing-plans 的 Task 逐个实现，每个 Task 经历红-绿-重构。

**两种执行模式**：

| 模式 | 做法 | 适合 |
|------|------|------|
| Subagent-Driven | 每个 Task 派一个独立子代理实现 | 任务独立、需要隔离 |
| Inline Execution | 当前会话中手动逐步执行 | 任务耦合、需要上下文 |

**TDD 三步**（每个 Task 都一样）：

```
1. 写一个会失败的测试（curl / node -e / 浏览器操作）
2. 确认测试失败
3. 写最简代码让测试通过
4. 确认测试通过
5. git commit
6. 进入下一个 Task
```

**实际例子 — Task 1（加 alerts 表）**：

```
Step 1 & 2 — 确认表不存在
$ node -e "db.prepare('SELECT * FROM alerts').all()"
→ SqliteError: no such table: alerts  ← 失败，符合预期

Step 3 — 写入 CREATE TABLE alerts + 5 个 prepared statements

Step 4 — 确认表已创建
$ node -e "db.prepare('SELECT name FROM sqlite_master WHERE name='alerts'').get()"
→ { name: 'alerts' }  ← 通过

Step 5 — git commit
```

**你要做什么**：等待每个 Task 完成通知。如果子代理报告 BLOCKED，告诉 Claude 原因；如果报告 DONE_WITH_CONCERNS，关注它提出的疑虑。

---

## 第六步：requesting-code-review（代码审查）

**干什么**：全部 Task 完成后，对整个分支做一次完整审查。

**触发**：
```
/superpowers:requesting-code-review
```

**会发生什么**：
1. Claude 生成全分支 diff 文件（`scripts/review-package BASE HEAD`）
2. 派发 Sonnet 子代理按 `code-reviewer.md` 模板审查
3. 审查维度：plan 对齐、代码质量、架构、安全、测试

**输出格式**：
```
### Strengths (做得好的地方)
### Issues
  #### Critical (必须修)
  #### Important (应该修)
  #### Minor (可以修)
### Assessment: Ready to merge? [Yes/No/With fixes]
```

**你要做什么**：
- 看审查结果，决定哪些要修
- Critical 和 Important 建议修完再合并
- Minor 可以记录后忽略

---

## 第七步：finishing-a-development-branch（合并收尾）

**干什么**：把 worktree 上的改动合回主分支，清理现场。

**触发**：
```
/superpowers:finishing-a-development-branch
```

**会发生什么**：
1. Claude 展示 4 个选项问你：
   - 1. 合并回 master
   - 2. 推送并创建 PR
   - 3. 保持现状
   - 4. 丢弃

2. 如果你选 1：
   - `git checkout master && git merge <feature-branch>`
   - smoke test 验证合并后代码能跑
   - 删除 worktree + 分支
   - 确认 `git worktree list` 干净

**你要做什么**：选选项，等着完成。

---

## 完整流程速查表

| 步骤 | 技能 | 你输入什么 | 产出物 |
|------|------|-----------|--------|
| 0 | 手动编辑 settings.json | 加 `bypassPermissions` | 不再弹窗 |
| 1 | `/superpowers:brainstorming` | 你的需求想法 | spec 文件 |
| 2 | 审阅 spec | "可以" / "这里改一下" | 确认的 spec |
| 3 | `/superpowers:writing-plans` | spec 路径 | plan 文件（7 个 Task） |
| 4 | 自动 | 无需操作 | 隔离 worktree |
| 5 | 自动（Subagent-Driven） | 无需操作 | 7 个 commit，逐个 TDD |
| 6 | `/superpowers:requesting-code-review` | 无需额外参数 | 审查报告 |
| 7 | `/superpowers:finishing-a-development-branch` | 选 1/2/3/4 | 合并到 master |

**总耗时**：取决于功能复杂度，简单功能（3-5 个 Task）约 15-30 分钟，中等功能（7-10 个 Task）约 30-60 分钟。

## 常见问题

### Q: 子代理一直报 "Permission denied" 怎么办？
A: 检查第零步——`settings.json` 里有没有 `"defaultPermissionMode": "bypassPermissions"`。光有白名单不够，子代理在 worktree 中可能匹配不上路径规则。

### Q: 我想中途改需求怎么办？
A: 回到 brainstorm 阶段告诉 Claude 你要改什么，它会更新 spec 文件，然后重新跑 writing-plans 生成更新后的 plan。

### Q: 代码审查发现 Important 问题怎么办？
A: 修完再合并。Claude 会帮你修，然后重新审查通过。

### Q: 结束后 worktree 没删干净？
A: 手工 `rm -rf .claude/worktrees/<名称>` 就行，不影响 git 仓库。
