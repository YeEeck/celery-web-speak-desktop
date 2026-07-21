# Celery Web Speak Desktop 架构设计

> 状态：v0.1.2 实现基线。
>
> 设计日期：2026-07-21。

## 目标

- 为 Windows 10/11 x64 与主流 Linux x64 桌面提供独立应用上下文。
- 复用服务器托管的 Celery Web Speak Vue UI 与 LiveKit Web 客户端。
- 允许用户配置一个 HTTP 或 HTTPS 自建服务器。
- Web UI 随服务器更新，不要求重新发布桌面安装包。
- 自动处理麦克风权限，降低浏览器权限操作成本。
- 提供 Windows Inno Setup 安装器、Windows 便携 ZIP 和 Linux AppImage。

## 非目标

- 不把 Vue Web、Go 服务端或 LiveKit Server 打包进桌面客户端。
- 不提供原生桌面版语音运行时，桌面继续使用 `livekit-client`。
- 不支持 macOS、Windows 7 或 ARM64。
- 不提供托盘常驻、开机启动、自动更新和后台消息推送。
- 不提供应用内网络代理设置。
- 不提供代码签名、Windows SmartScreen 信誉或 Linux 软件仓库。
- 不收集遥测、崩溃报告或远程日志。

## 已确认决策

| 决策项 | 结论 |
| --- | --- |
| 仓库 | 独立 `celery-web-speak-desktop` 仓库 |
| 桌面框架 | Electron + TypeScript |
| Web 内容 | 直接加载服务器远程页面 |
| 当前服务器 | 首期只配置一个当前 URL |
| 服务器根路径 | 仅支持 Origin 根部署，不支持子路径 |
| HTTP 页面 | 允许，并把当前 HTTP Origin 视为安全上下文 |
| TLS 错误 | 对整个 Electron 进程忽略 |
| 麦克风权限 | 当前服务器 Origin 自动允许，不显示壳级对话框 |
| 其他权限 | 当前服务器按 Electron 默认行为处理，其他 Origin 拒绝 |
| 网络代理 | 使用操作系统代理 |
| 单实例 | 是 |
| 窗口关闭 | 立即退出应用和语音 |
| Windows | x64 Inno 安装器 + 便携 ZIP |
| Linux | x64 AppImage |
| 发布 | 独立 `v*` 标签与 GitHub Actions |
| DevTools | 开发环境可用，正式包禁用入口和快捷键 |
| 图标 | 首期使用字母 C 品牌图标 |
| 窗口框架 | Windows 与 Linux 使用统一的深色自绘标题栏，不显示原生应用菜单栏 |
| 关闭语义 | 关闭按钮立即退出应用并结束语音，不引入托盘驻留 |

## 总体结构

```text
+-----------------------+
| Electron Main Process |
|                       |
| Config Store          |
| Window Manager        |
| Session Policy        |
| Health Validator      |
+-----------+-----------+
            |
            | narrowly scoped local IPC
            v
+-----------------------+       +------------------------------+
| Local Setup Window    |       | Remote Application Window    |
| title bar / URL form  |       | local title bar shell        |
+-----------------------+       | +--------------------------+ |
                                | | remote WebContentsView   | |
                                | | Vue / LiveKit Web        | |
                                | +------------+-------------+ |
                                +--------------|---------------+
                                               v
                                   Go API / WS / LiveKit
```

本地配置窗口和远程应用窗口是两个不同的无边框 `BrowserWindow`。配置窗口使用只包含配置与窗口控制 IPC 的 preload。远程应用窗口的本地壳层只负责标题栏和菜单，服务器页面承载在独立的 `WebContentsView` 中；远程页面本身不加载 preload，也不获得 Node.js 或 Electron API。

切换服务器时销毁远程窗口、显示配置窗口、保存新 Origin，然后重启应用。重启保证启动早期的 Chromium HTTP 安全上下文参数与当前服务器一致。

## 窗口框架与菜单

Windows 与 Linux 使用一致的 32px 深色自绘标题栏。左侧显示应用图标和名称，中间区域可拖动窗口，右侧依次提供“更多”、最小化、最大化/还原和关闭按钮。双击可拖动区域切换最大化状态；最大化状态变化时同步更新还原按钮和无边框窗口布局。

不安装 Electron 原生应用菜单栏。“更多”菜单使用受主窗口约束的本地无边框弹窗，避免系统原生菜单随桌面主题显示为浅色。菜单与标题栏共用深色视觉语言，失去焦点或执行命令后立即关闭，并只向用户提供以下命令：

- 切换服务器。
- 重新加载远程页面。
- 关于 Celery Web Speak。
- 退出。

撤销、重做、剪切、复制、粘贴与全选不再占用可见菜单空间，远程页面继续使用 Chromium 的标准编辑快捷键。开发环境的 DevTools 能力不出现在用户菜单中，正式包继续阻止 DevTools。

配置页与标题栏使用同一套接近 Discord 的深色界面，同时保留 Celery 绿色作为品牌识别色。服务器地址的部署路径、证书策略和 HTTP 麦克风实现不作为常驻说明展示；输入错误或连接失败时再提供面向操作的状态反馈。

“更多”图标使用几何居中的三个圆点，避免字体省略号受基线影响而视觉下沉。配置窗口默认尺寸为 560x420，正常状态下紧凑展示完整表单；出现较长错误反馈时允许内容区滚动。

## 目录规划

```text
src/
  main/
    main.ts                 Electron 生命周期与单实例
    config.ts               配置读取、规范化和原子写入
    server-validator.ts     /api/health 验证
    windows.ts              配置窗口和远程窗口
    session-policy.ts       权限、证书和导航策略
  preload/
    setup.ts                仅本地配置窗口可用的 IPC
  renderer/
    setup.html
    setup.css
    setup.js
  shared/
    setup-api.ts            配置 IPC 类型
  assets/
    icon-source.svg         图标源文件
build/
  installer.iss             Inno Setup 脚本
  icons/                    平台图标产物
scripts/
  copy-static.mjs
  build-icons.mjs
tests/
docs/
```

## 配置模型

配置保存在 Electron `userData` 下的 `config.json`：

```json
{
  "version": 1,
  "serverUrl": "https://voice.example.com",
  "window": {
    "width": 1280,
    "height": 800,
    "x": null,
    "y": null,
    "maximized": false
  }
}
```

约束：

- 必须显式包含 `http://` 或 `https://`。
- URL 不允许用户名、密码、查询参数和 Fragment。
- Path 只能为空或 `/`。
- 保存值规范化为 `URL.origin`，不保留尾部 `/`。
- 配置损坏时保留原文件并回到配置页，不猜测服务器。
- 写入使用同目录临时文件和重命名，避免中途中断留下半个 JSON。

Cookie、LocalStorage、IndexedDB 和缓存由持久 Session 保存，不写入 `config.json`。不同服务器 Origin 的 Web 数据由 Chromium 自然隔离，切换服务器时不清除。

## HTTP 安全上下文

Chromium 的 `--unsafely-treat-insecure-origin-as-secure` 只接受逗号分隔的完整 Origin，不支持受支持的全局通配符。实现规则：

1. Electron 初始化最早阶段同步读取当前配置。
2. 当前服务器为 HTTP 时，调用：

   ```text
   app.commandLine.appendSwitch(
     "unsafely-treat-insecure-origin-as-secure",
     currentServerOrigin
   )
   ```

3. 首次保存或切换服务器后执行 `app.relaunch()` 并退出当前进程。
4. 此后每次启动自动应用当前 Origin，不再要求用户操作。

不使用 `disable-web-security`。该开关不会等价地建立可信安全上下文，还会关闭同源策略并允许不安全跨域内容，可能改变应用业务行为。

## TLS 策略

根据已确认需求，桌面壳在启动早期启用 Electron 的 `ignore-certificate-errors` Chromium 开关，忽略当前进程内所有 HTTPS/WSS 证书错误。

这意味着服务器页面、API、LiveKit WSS 和页面连接的其他 TLS 主机均不再获得标准证书身份保护。该行为只影响当前 Electron 应用进程，不修改操作系统信任库或其他应用。

设置页必须明确显示“应用将忽略服务器证书错误”。日志不记录证书内容、Cookie 或 Token。

## 健康验证

保存服务器前请求：

```text
GET {serverOrigin}/api/health
```

成功条件：

- HTTP 状态为 200。
- 响应为 JSON 对象。
- `status` 严格等于 `ok`。

失败时显示结构化错误并提供：

- 重新验证。
- 修改地址。
- 忽略验证并强制进入。

强制进入只跳过健康验证，不放宽 URL 结构约束。应用日常启动不阻塞等待健康检查，直接加载已保存服务器；远程页面自身负责展示连接错误。

## Window 与生命周期

### 单实例

使用 `app.requestSingleInstanceLock()`。第二个实例启动时，激活已有窗口；不创建第二个 LiveKit 或业务 WebSocket 连接。

### 本地配置窗口

- 首次启动或用户选择切换服务器时显示。
- 默认 560x420，最小尺寸为 520x400。
- 加载打包的本地 HTML。
- 开启 `contextIsolation` 与 `sandbox`。
- 关闭 `nodeIntegration`。
- 只加载配置 preload。

### 远程应用窗口

- 默认 1280x800，最小 960x640。
- 记住最后位置、大小和最大化状态。
- 加载当前服务器 Origin 根页面。
- 开启 `contextIsolation`、`sandbox` 和 `webSecurity`。
- 关闭 `nodeIntegration`。
- 不加载 preload。
- 关闭窗口即退出进程，不转入托盘。
- 正式包拦截 DevTools 快捷键并关闭已意外打开的 DevTools。

窗口位置恢复前必须验证仍与当前显示器相交，防止外接显示器移除后窗口不可见。

## Session 与权限

远程应用使用独立持久 Session，例如 `persist:celery-web-speak`。

Electron 未配置权限处理器时会自动批准权限请求。为避免跨 Origin 页面继承该行为，应用配置检查和请求处理器：

- 请求 Origin 与嵌入 Origin 都等于当前服务器 Origin时，按 Electron 默认宽松语义批准。
- 麦克风媒体请求自动批准，不显示壳级确认框。
- 请求来自其他 Origin 或无法确定顶层页面时拒绝。
- 屏幕共享设备选择由 Electron 独立的 display media 流程处理，不增加无提示选择逻辑。
- 浏览器窗口始终由操作系统麦克风隐私设置进行最终约束。

当前 Web 只使用麦克风与剪贴板写入。摄像头、通知、剪贴板读取等能力没有当前业务入口，但桌面壳不为当前服务器 Origin 增加额外产品限制。

## 导航、弹窗和下载

- 当前服务器同 Origin 导航留在远程窗口。
- 跨 Origin 顶层导航交给系统浏览器。
- `window.open` 创建的窗口继续强制 `sandbox`、关闭 Node.js 和 preload。
- 自定义协议由系统处理前必须经过显式 `http:`/`https:` 判断，未知协议不自动打开。
- 首期不提供应用内下载管理器；Electron/Chromium 的标准下载行为保持不变。

## 应用菜单

正式应用菜单提供：

- 服务器：切换服务器、重新加载、退出。
- 编辑：撤销、重做、剪切、复制、粘贴、全选。
- 窗口：最小化、缩放、关闭。
- 帮助：关于 Celery Web Speak。

不提供正式包 DevTools 菜单。开发模式增加重新加载和 DevTools 入口。

## 日志

- 只写本地日志，不上传。
- 记录应用启动、窗口生命周期、配置错误和健康检查结果。
- 不记录密码、Cookie、完整请求头、LiveKit Token 或页面正文。
- 服务器 URL 可在配置 UI 显示，但日志只记录 Origin，不记录路径参数；当前设计本身禁止参数。
- 日志滚动与保留策略在实现阶段保持轻量，首期可以只保留当前与上一份日志。

## 构建与发布

### 依赖

- Electron 固定精确版本。
- TypeScript 编译 Main 与 preload。
- electron-builder 生成 unpacked 应用、Windows 便携 ZIP 和 Linux AppImage。
- Inno Setup 从 Windows unpacked 应用生成安装器。

### Windows Inno Setup

- 按当前用户安装到 `{localappdata}`，不请求管理员权限。
- 创建开始菜单快捷方式。
- 桌面快捷方式由用户选择。
- 卸载默认保留 Electron `userData`。
- 卸载页提供可选“删除用户数据”任务。
- 简体中文消息文件固定保存在 `build/languages/`，构建时不依赖 Inno Setup 安装目录中的非官方翻译。
- 安装器和便携包均为 x64 且不签名。

### GitHub Actions

独立仓库使用自己的 `v*` 标签：

- Windows runner 构建 unpacked 应用、便携 ZIP 和 Inno 安装器。
- Ubuntu runner 构建 AppImage。
- 构建产物上传到对应 GitHub Release。
- workflow_dispatch 允许手动构建但不自动创建正式版本。

发布版本只表示桌面壳版本，与服务器和 Web 版本独立。

## 测试策略

### 单元测试

- URL 规范化与拒绝规则。
- 配置损坏、默认值和原子写入。
- 健康响应解析。
- Origin 权限判断。
- 窗口范围恢复规则。

### Electron 集成测试

- 首次启动显示配置页。
- 健康检查成功后保存并请求重启。
- 健康检查失败后可以强制进入。
- HTTP Origin 在重启后成为安全上下文。
- 当前 Origin 麦克风权限自动允许。
- 跨 Origin 导航交给系统浏览器。
- 切换服务器保留各 Origin Cookie。
- 关闭窗口后进程退出。
- 正式包无法通过菜单或快捷键打开 DevTools。

### 平台验收

- Windows 10/11 x64 安装、卸载、便携运行和麦克风通话。
- Windows Inno 当前用户安装不触发管理员权限。
- Linux AppImage 在主流 X11/Wayland 桌面启动和通话。
- HTTP、证书错误 HTTPS 与正常 HTTPS 服务器均能进入。
- LiveKit UDP、TCP 和 TURN 回退行为与普通 Chromium 一致。

## 实施顺序

1. 提交本文档。
2. 建立 TypeScript、测试和静态资源构建骨架。
3. 实现配置模型、URL 校验和健康验证。
4. 实现配置窗口和 IPC。
5. 实现远程窗口、Session、权限、导航和菜单。
6. 实现窗口状态、日志和单实例行为。
7. 制作字母 C 平台图标。
8. 实现 electron-builder、Inno 和 GitHub Actions。
9. 完成 Linux 本机运行与可执行产物验证。
10. 在 Windows runner 验证 Inno 与便携 ZIP。

## 完成定义

- 本地测试、TypeScript 类型检查和生产构建通过。
- Linux AppImage 能在本机或 CI 环境生成。
- Windows workflow 能生成 Inno 安装器与便携 ZIP。
- 配置页覆盖首次进入、验证失败、强制进入和服务器切换。
- HTTP 当前 Origin 可使用麦克风。
- TLS 错误被全局忽略，且文档和 UI 均明确提示。
- 正式远程窗口没有 Node.js、preload 或 DevTools 入口。
- 工作区无未提交改动。

## 当前验证结果

截至 2026-07-21：

- TypeScript 严格类型检查通过。
- 21 个配置、健康检查、Origin 和窗口状态单元测试通过。
- 2 个真实 Electron 集成测试通过。
- HTTP 测试页面在精确 Origin 开关下报告 `window.isSecureContext === true`。
- HTTP 测试页面在无壳级提示下成功取得假麦克风音轨。
- Linux x64 AppImage 已在本机生成并启动到窗口事件循环。
- Windows ZIP 和 Inno 脚本已进入 CI，仍需第一次 Windows workflow 运行确认最终安装产物。
