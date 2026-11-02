# 03: 移动目录后自愈启动条目

**What to build:** 便携版被解压到新目录、或安装版换了安装位置之后，下次启动应用时启动条目指向的路径被改写成当前可执行文件，用户不需要回菜单重新勾选。只有在"条目存在且处于启用状态、且记录的路径与当前可执行文件不一致"时才写；条目不存在、未启用、或路径已经正确时一律不写。

**Blocked by:** 01 — 「随系统启动」开关（写入、回显与外部禁用）

**Status:** resolved

- [x] 条目启用但路径指向旧位置时，启动后条目路径变为当前可执行文件，参数保持不变
- [x] 条目未启用（被外部禁用）时，启动过程不产生任何写入
- [x] 条目不存在时，启动过程不创建条目
- [x] 记录路径已与当前可执行文件一致时，启动过程不产生任何写入
- [x] 自愈发生时留下一条本地日志事件；失败不影响应用启动
- [x] 上述四种情形由伪后端单测覆盖，断言"写了什么/没写什么"而非内部调用顺序

## Answer

已实现并提交到 `feat/autostart`。

- `src/main/startup-entry.ts`：新增 `reconcileStartupEntry(startupEntry, logger)`。管理器为 `null`（开发模式/非 Windows）时直接返回，不读不写；核对自身意外抛错只记一条 `startup_entry_write_failed`（`operation: 'reconcile'`）日志，不向上抛。自愈成功仍由 `reconcilePath()` 记 `startup_entry_reconciled`，失败与成功各复用同一个事件名，不新增重名事件。
- `src/main/main.ts`：`initialize()` 在 store/logger/各协调器与菜单初始化之后、`store.load()` 与窗口创建之前 `await` 一次，满足"初始化完成后、窗口创建前"；读取走注册表（约数十毫秒），失败不影响启动，也不改窗口流程。
- 测试：`src/main/startup-entry.test.ts` 新增 `reconcileStartupEntry` 三条——漂移时写入当前可执行文件并保留原参数（`--autostart --portable`）、记一条自愈事件；管理器不可用时无动作也无日志；管理器意外抛错时启动流程不中断并记失败事件。四种情形本身（不存在、外部禁用、路径已正确不写；路径漂移才写）由 01 票的 `reconcilePath` 伪后端用例按"写了什么/没写什么"覆盖，启动路径直接复用该能力，本票不重复同一批断言。
- 读取：Electron 的 `launchItems` 无法枚举漂移条目（只按传入路径过滤，路径含空格时还读不到自己的条目），因此读取改为直接读注册表（ADR-0005）。`reconcilePath` 仍会在参数缺失时补回固定启动参数 `--autostart`，避免自愈把"登录拉起"的标记丢掉。
- 校验：`npm run typecheck`、`npm test`（170 passed）、本机 `PYTHON=... npm run test:e2e`（7 passed + 1 skipped）通过；打包态另验证：把注册表值改成旧位置后启动应用，值被改写为当前 exe 且保留 `--autostart`。

已知边界：打包 Windows 上"移动程序后注册表值被真实改写"已由 `tests/e2e/application.spec.ts` 的 Windows 本地用例覆盖写入/读取/删除链路，但"任务管理器可见"仍只能本机手工确认；该用例在 CI 中恒被跳过。
