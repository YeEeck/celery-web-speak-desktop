# 02: 登录拉起时不打扰（最小化、不抢焦点）

**What to build:** 应用被启动条目拉起时（命令行含 `--autostart`），窗口以最小化出现在任务栏、不抢焦点、不弹任何提示。没有该参数时行为与今天完全一致。服务器不可达时切出的配置页同样以最小化出现——否则登录瞬间会凭空弹出一个用户没预期的窗口。用户从任务栏恢复窗口时，看到的仍是上次记录的尺寸与最大化状态。

**Blocked by:** 01 — 「随系统启动」开关（写入、回显与外部禁用）

**Status:** resolved

- [x] 命令行中的 `--autostart` 由主进程最早阶段解析为纯函数，与其它参数共存时不误判
- [x] 带 `--autostart` 启动时，首个窗口 `isMinimized()` 为真且不是当前聚焦窗口
- [x] 不带该参数启动时，窗口正常显示并聚焦，行为与改动前一致
- [x] 带 `--autostart` 且服务器不可达时，切出的配置页同样最小化
- [x] 从任务栏恢复后，窗口尺寸与最大化状态与上次关闭时记录的一致（含"上次是最大化"的情形）
- [x] 该行为与平台无关，可在 Linux e2e 环境验证；e2e 复用现有启动 helper，只增加"追加参数"能力
- [x] 关闭窗口仍然立即退出进程，不因最小化启动而改变生命周期

## Answer

已实现并提交到 `feat/autostart`。

- `src/main/startup-args.ts`：`isAutostartLaunch(argv)` 只匹配精确的 `--autostart`；`--autostart=1`、`--no-autostart`、路径中恰好含该串等均不算。主进程在模块顶层、app ready 之前解析 `process.argv`。
- `src/main/windows.ts`：新增 `WindowPresentation`（normal / autostart）。窗口仍以 `show: false` 创建，`ready-to-show` 时先恢复记录的最大化状态，再按呈现方式处理：autostart 走 `showInactive()` + `minimize()`，普通模式仍 `show()`。配置窗口与远程窗口共用该机制。
- `src/main/main.ts`：启动流程（首次无配置、远程加载失败切配置页）把 autostart 呈现传给 `showSetup`；用户从菜单「切换服务器」打开配置页、从配置页取消返回远程都保持 normal。关闭窗口、`window-all-closed`、`before-quit` 未改动。
- 测试：`src/main/startup-args.test.ts` 覆盖精确匹配、参数共存与近似值；e2e 的 `launch` helper 增加追加参数能力，覆盖最小化且不聚焦、恢复后尺寸、最大化恢复、服务器不可达时配置页最小化、用户切换服务器正常显示、关闭窗口退出进程。
- 校验：`npm run typecheck`、`npm test`（158 passed）、`PYTHON=... npm run test:e2e`（8 passed，Windows 本机）通过。实现无平台分支，Linux CI 复用同一套 e2e 断言。

已知边界：以 `--autostart` 启动的会话在配置页保存服务器后会走既有 `app.relaunch()`。重启属于用户操作，`relaunchArguments` 会剥离 `--autostart`，新进程按普通方式呈现（修复提交 `0ca399f`），避免保存服务器后窗口再次最小化。
