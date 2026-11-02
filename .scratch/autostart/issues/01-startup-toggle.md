# 01: 「随系统启动」开关（写入、回显与外部禁用）

**What to build:** Windows 正式包的用户可以在"更多"菜单里看到一个「随系统启动」勾选项。勾选后操作系统侧出现本应用的启动条目，取消勾选后条目消失；重新打开菜单时，勾选状态来自操作系统的真实状态，而不是应用自己的记忆——用户在任务管理器"启动"页禁用或删除条目后，菜单会如实变成未勾选。写入静默失败时，勾选随重新读取的结果弹回未勾选，并留下一条本地日志。开发模式与非 Windows 平台看不到该项，也不能绕过它触发系统写入。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 启动条目模块以可注入后端实现，对外只有"读启用状态 / 设置启用 / 路径核对"三个能力；后端用伪实现即可在非 Windows 上覆盖全部五种状态（不存在、启用、外部禁用、路径漂移、写入抛错）
- [x] 条目名固定为 `Celery Web Speak`，写入的命令行包含 `--autostart` 参数；启用状态按"名字 + 当前可执行文件路径"判定，不依赖 `openAtLogin`
- [x] 菜单出现「随系统启动」，位于「自动检查更新」相邻位置，远程模式与配置模式都显示，键盘导航可选中并触发
- [x] 勾选后重新打开菜单显示已勾选；取消勾选后重新打开显示未勾选；整个过程不需要重启应用
- [x] 条目被外部删除或被外部禁用后，重新打开菜单显示未勾选
- [x] 后端写入抛错时，重新打开菜单仍显示未勾选，且日志出现对应事件；不弹出任何对话框
- [x] 开发模式（未打包）下菜单不出现该项，且即使渲染层伪造该动作，主进程也拒绝
- [x] 非 Windows 平台下菜单不出现该项
- [x] 菜单弹出窗口高度随项目数调整，新增项之后最后一项完整可见、底部无空白
- [x] `config.json` 不出现新字段；切换服务器后该开关的表现不变

## Answer

已实现并提交到 `feat/autostart`。

- `src/main/startup-entry.ts`：`StartupEntryManager` 对外只有 `isEnabled` / `setEnabled` / `reconcilePath` 三个能力；`StartupEntryBackend` 可注入。写入 `--autostart` 与 `enabled: true`、删除按固定名字都走 Electron 登录项 API；读取走 `src/main/startup-entry-registry.ts` 直接读注册表（`Run` 值 + `StartupApproved`），因为 `launchItems` 只按路径过滤且路径含空格时读不到条目（ADR-0005）。启用判定为"条目存在 && 系统 enabled && 路径与当前可执行文件一致"，路径使用 Windows 语义规范化并忽略大小写。平台与打包门控（`packaged && win32`）收在 `createStartupEntry` 内，不支持时返回 `null`，调用方无需判断平台。读取接口为异步；写入后重读并以重读结果为准；失败只写日志（`startup_entry_enabled` / `startup_entry_disabled` / `startup_entry_write_failed` / `startup_entry_reconciled`），不抛错、不弹框。
- `src/main/startup-entry.test.ts`：伪后端覆盖不存在、启用、外部禁用、路径漂移、写入抛错五种状态，并覆盖写后重读未生效、删除失败不伪造成功、路径核对不做无谓写入、固定条目名与启动参数。`reconcilePath` 本票只实现能力与单测，未接入启动流程（留给 03 票）。
- 菜单：`src/shared/menu-api.ts` 新增 `toggle-autostart` 动作，`MenuState` 改为按动作索引的 `checks`；「随系统启动」紧邻「自动检查更新」，远程与配置模式均显示；每次打开菜单时由 `WINDOW_CHANNELS.showMenu` 重读系统状态传入，切换后关闭菜单、下次打开即新状态。未打包/非 Windows 下菜单不渲染该项，菜单层与主进程双层拒绝伪造动作。
- 高度：`applicationMenuHeight` 按可见项目数计算（远程 245 / 加入开关 279；配置 168 / 加入开关 202），`src/main/menu.test.ts` 覆盖。
- 校验：`npm run typecheck && npm test` 通过（170 个单测）；本机 e2e 7 passed + 1 skipped（未打包时该项不可见；Windows 本地真实条目用例在检测到既有条目时按设计跳过）。
- 打包态验证：在 `release\win-unpacked` 中打开菜单，条目存在时显示勾选；点击后注册表值删除、菜单变为未勾选；再次点击后值恢复并指向当前 exe；把值改成旧位置后启动应用，值被自愈改写为当前 exe。

已知覆盖缺口："任务管理器可见"仍只能本机手工确认；CI 不覆盖。
