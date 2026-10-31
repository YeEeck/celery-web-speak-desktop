# 04: 卸载时清理启动条目

**What to build:** 通过 Inno 安装版卸载后，启动条目随之消失——用户不会在下次登录时遇到"找不到程序"的系统错误框。条目本来就不存在时静默跳过。卸载时"是否同时删除服务器地址、登录状态和本地设置"的既有询问与行为保持不变。

**Blocked by:** 01 — 「随系统启动」开关（写入、回显与外部禁用）

**Status:** resolved

- [x] 卸载流程按与运行时相同的值名删除当前用户的启动值
- [x] 条目不存在时卸载不报错、不弹窗
- [x] 从未勾选过该开关的用户卸载后系统状态无变化
- [x] 卸载时删除用户数据的选择行为与文案不变
- [x] 安装器脚本中值名与运行时模块使用同一个字符串，并有注释指明两处必须一致
- [x] 本地消息文件校验用例仍然通过（安装器只允许引用仓库内存在的语言文件）

## Answer

已实现并提交到 `feat/autostart`。

- `build/installer.iss`：`[Code]` 新增 `StartupEntryName` / `StartupRunKey` 常量与 `RemoveStartupEntry`，在 `usUninstall` 阶段先按 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的 `Celery Web Speak` 值执行 `RegValueExists` 检查，存在才 `RegDeleteValue`；值不存在时静默跳过，不提示、不报错。清理在用户数据询问之前无条件调用，因此用户选择“否”也会清理启动值。
- 启动值名与 `src/main/startup-entry.ts` 的 `STARTUP_ENTRY_NAME` 保持一致，脚本内注释说明 Inno 无法 import TypeScript、两处必须同步；安装器仍没有 `[Registry]` 或 `[Tasks]` 创建启动条目。
- 既有“是否同时删除服务器地址、登录状态和本地设置？”文案与 `DelTree` 行为未改动；语言文件校验用例保留。
- `tests/unit/installer.test.ts` 新增用例：直接 import `STARTUP_ENTRY_NAME` 断言与安装器值名相同；断言 `RegDeleteValue` 被 `RegValueExists` 守护且清理过程无 `MsgBox`；断言安装器未通过 `[Registry]` 或 `[Tasks]` 创建启动条目、用户数据询问文案与删除行为未变。
- 校验：`npm run typecheck && npm test` 通过（156 passed）；本机 Inno Setup 6.7.0 以临时 `SourceDir`/`OutputDir` 编译 `installer.iss` 成功，未改动 CI。

已知边界：真实安装→卸载后的注册表删除只能本机手工验证，本机仅验证脚本可编译与逻辑有测试守护。
