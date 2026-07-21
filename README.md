# Celery Web Speak Desktop

Celery Web Speak 的 Windows 与 Linux Electron 客户端壳。

客户端不打包服务器 Web UI，而是加载用户配置的 Celery Web Speak 服务器。登录 Cookie、LocalStorage 和其他站点数据保存在 Electron 独立用户目录中，不与系统浏览器共享。

当前版本为 `0.2.0`，已实现服务器配置、远程 Web 加载、HTTP 麦克风安全上下文、自动权限、自绘窗口框架、深色应用菜单，以及 Windows 应用音频的本地来源选择、Process Loopback 采集和受限 Bridge。

当前实现见 [架构设计](docs/architecture.md)，Windows 应用音频的原生采集与安全边界见 [Windows 应用音频设计](docs/application-audio-design.md)。

## 计划产物

- Windows x64 Inno Setup 安装器
- Windows x64 便携 ZIP
- Linux x64 AppImage

Windows 安装器按当前用户安装，不请求管理员权限。项目不包含自动更新、遥测、托盘常驻和开机启动。

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
