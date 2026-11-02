# 启动条目状态直接读注册表，不再依赖 Electron 登录项列表

[ADR-0004](0004-startup-entry-owned-by-application.md) 决定“状态真相取操作系统”，并指定用 `app.getLoginItemSettings().launchItems` 的 `enabled` 读取任务管理器里的启用状态。打包实测（Electron 43.1.1 / Windows 11）发现该 API 无法承担这个职责：

- `launchItems` 不是全部条目的列表，而是“解析出的可执行文件路径与传入 `path` 匹配（前缀匹配）”的条目。不传 `path` 时它拿 `process.execPath` 去匹配，因此**无法发现指向旧位置的条目**，路径自愈失去依据。
- 可执行文件路径含空格时，注册表值被写成带引号的形式，Electron 的路径比较对不上：**自己写入的条目在 `launchItems` 里也读不回来**，`openAtLogin`、`executableWillLaunchAtLogin` 同样为 false。本应用的安装路径（`…\Celery Web Speak\Celery Web Speak.exe`）必然含空格，实测“勾选后菜单仍不勾选”。

决定：写入与删除继续用 `app.setLoginItemSettings`（它正确维护 Run 值与 StartupApproved 启用状态），**读取改为直接读注册表**：

- 用 `reg export` 导出当前用户 `Run` 键到临时 `.reg` 文件（UTF-16LE，规避控制台代码页），解析目标条目名对应的命令行，得到记录的可执行文件路径与参数。
- 用同一方式导出 `StartupApproved\Run`，按二进制值判断启用状态：没有记录或首个 DWORD 为 0/2 视为启用，其余（如 3 = 任务管理器禁用）视为停用，与 Electron/任务管理器一致。

代价：读取需要启动一次 `reg.exe`（实测约 15–20 ms/次），因此启动条目模块的读取接口改为异步；打开菜单、启动自愈与开关切换都等待读取结果。写入路径不变，卸载清理仍按同一个值名删除。

后果：`launchItems` 不再参与本功能；Windows 本地 e2e 与单测都改为验证注册表读取（含含空格路径、中文路径与 StartupApproved 禁用态）。
