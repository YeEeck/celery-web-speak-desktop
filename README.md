# Celery Web Speak Desktop

Celery Web Speak 的 Windows 与 Linux Electron 客户端壳。

客户端不打包服务器 Web UI，而是加载用户配置的 Celery Web Speak 服务器。登录 Cookie、LocalStorage 和其他站点数据保存在 Electron 独立用户目录中，不与系统浏览器共享。

当前版本为 `0.2.21`，已实现服务器配置、远程 Web 加载、HTTP 麦克风安全上下文、自动权限、自绘窗口框架、深色应用菜单、GitHub Releases 更新检查、Windows 应用音频的本地来源选择、Process Loopback 采集和受限 Bridge，以及游戏内语音浮层（透明置顶穿透窗口，配置化大小/位置/不透明度）。

当前实现见 [架构设计](docs/architecture.md)，Windows 应用音频的原生采集与安全边界见 [Windows 应用音频设计](docs/application-audio-design.md)。

## 计划产物

- Windows x64 Inno Setup 安装器
- Windows x64 便携 ZIP
- Linux x64 AppImage

Windows 安装器按当前用户安装，不请求管理员权限。项目不包含自动下载安装、遥测、托盘常驻和开机启动。

## 使用

首次启动时输入完整的 Celery Web Speak 服务器地址，例如：

```text
https://voice.example.com
```

服务器必须部署在 Origin 根路径，不能使用 `https://example.com/cws/` 形式。客户端会验证公开的 `GET /api/health`；验证失败时可以确认后强制进入。

客户端按已确认的宽松连接策略运行：

- 忽略当前 Electron 进程中的 HTTPS/WSS 证书错误。
- 当前服务器为 HTTP 时，重启后把该精确 Origin 视为 Chromium 安全上下文。
- 当前服务器顶层 Origin 的权限请求自动允许，其他 Origin 拒绝。
- 远程页面没有 Node.js、preload 或通用 Electron API。

切换服务器使用标题栏右上角“更多”菜单中的“切换服务器”。不同 Origin 的 Cookie 与 LocalStorage 分别保留。

## 更新检查

客户端启动后可自动查询 GitHub Releases，也可以从标题栏右上角“更多”菜单手动检查。更新检查只提示并打开 Release 下载页，不会自动下载或安装。

只有最近一次成功检查确认存在新版本时，标题栏才显示“新版本”按钮；点击按钮会重新显示该版本的更新对话框。临时网络错误不会清除最近一次成功检查得到的更新信息。

## 语音浮层

游戏内语音状态浮层：以透明置顶穿透窗口叠加在游戏画面上的只读语音状态展示，实时反映语音参与者的说话、静音与聋状态。

- **开关入口**：语音操作区的浮层图标按钮，与设置面板"语音浮层"页中的开关双向同步。
- **配置**：设置面板"语音浮层"页提供显示大小（50%~150%）、水平/垂直位置（窗口中心点的屏幕百分比，50% 即正中）、说话与未说话两档不透明度（10%~100%），拖动实时生效并保存在当前浏览器。
- **浮层页面**：由连接的 Web 服务渲染（`/overlay.html`），因此浮层要求 Web 服务在线；桌面壳只承担窗口几何与数据转发。
- **兼容**：浮层要求客户端与 Web 服务协商协议 3（客户端 0.2.21+ 与 Web 0.4.29+）。协商回退到协议 2 及以下时浮层整体禁用。

### 平台限制

- 浮层在 **Windows 独占全屏**与 **Linux Wayland** 会话下不可见（X11 正常）；OBS 等录制软件的游戏源捕获不到浮层，需要改用显示器捕获。
- 浮层不提供拖动、热键与多显示器跟随，位置按浮层所在屏幕的百分比计算。
- 浮层为只读展示，不响应鼠标交互。

## 开发

要求 Node.js 22：

```bash
npm ci
npm run typecheck
npm test
npm run test:e2e:linux
npm start
```

`test:e2e:linux` 需要 `xvfb-run`。集成测试会启动真实 Electron，验证配置窗口以及 HTTP安全上下文中的自动麦克风权限。

## 构建

```bash
npm run package:linux
npm run package:win-dir
npm run package:win-zip
```

`npm run package:linux` 在 `release/` 生成 AppImage。Windows Inno 安装器由 `.github/workflows/release.yml` 在 Windows runner 上调用 `build/installer.iss` 生成。

推送独立仓库的 `v*` 标签会创建 GitHub Release，并附加 Windows Inno 安装器、Windows 便携 ZIP 和 Linux AppImage。

## 许可证

GNU General Public License v3.0，见 [LICENSE](LICENSE)。
