# AGENTS.md

## GIT
- 提交信息使用中文，但仍保留诸如 fix: feat: 等英文前缀

## 执行要求
- 在用户没有明确要求的情况下，不要使用 Worktree。而是开一个新分支直接开发，但不要按 Task 新建分支
- 需要控制 Commit 粒度，一次 Commit 的粒度不宜过粗
- 在开始前先提交文档
- 绝大多数情况下，在你觉得适合的时候，自动进行 commit，不要在任务完成后仍使工作区处于一个未提交状态。除非当前状态存在问题

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels, each string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
