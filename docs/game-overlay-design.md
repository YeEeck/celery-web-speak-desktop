# Celery Web Speak Desktop 游戏内语音状态 Overlay 设计

> 状态：已确认方案，尚未实施。
>
> 设计日期：2026-08-01。
>
> 当前桌面实现基线：v0.2.18。

## 已确认决策

| 决策项 | 结论 |
| --- | --- |
| 术语 | **语音浮层**，见主仓库词汇表 |
| 实现路线 | 透明置顶穿透窗口，否决进程注入（ADR-0001） |
| 开关归属 | Web 用户设置面板"客户端偏好"区，经桥驱动壳层；浏览器环境无桥能力时隐藏开关 |
| 显示内容 | 频道名 + 全部语音参与者（头像、显示名、说话高亮、静音/聋标记，含自己） |
| 位置与交互 | 固定左侧垂直居中、距窗口边缘 32px；无拖动、无位置持久化、鼠标全程穿透 |
| 平台范围 | Windows 与 Linux X11；Wayland 明确不支持 |
| 生命周期 | 开关即常驻；未连接语音显示"未连接语音"空态；壳层不感知语音会话 |
| 主窗口影响 | 无——不自动最小化、不联动窗口管理、不提供全局热键 |

## 背景

主流语音软件（Discord、KOOK 等）提供游戏内 Overlay：在游戏画面上叠加显示当前语音频道内的成员及其说话状态，让玩家不必切换窗口即可知道谁在说话。

本文评估在当前项目（服务器托管的 Vue Web UI + Electron 薄壳）中实现该能力的可行性与方案选择。Overlay 的数据源（成员、说话状态）在 Web 页面的 `livekit-client` Room 中；桌面壳提供叠加渲染层。

## 竞品方案

| 产品 | 实现方式 | 平台覆盖 |
| --- | --- | --- |
| Discord | 原生 DLL 注入游戏进程，Hook D3D9/D3D11/D3D12/Vulkan Present 调用后直接绘制到游戏交换链 | 仅 Windows |
| KOOK | Electron 透明置顶穿透窗口 | 仅 Windows，独占全屏下不可见 |
| Mumble | 原生注入 + OpenGL/D3D Hook | 仅 Windows |
| TeamSpeak | 无官方游戏 Overlay | — |

两条技术路线：**进程注入**（Discord/Mumble）与**透明置顶窗口**（KOOK）。Electron 应用天然适配后者，这是 KOOK 选它的原因。

## 方案对比

### 方案 A：透明置顶穿透窗口（推荐）

在主窗口之外创建一个本地渲染的无边框透明 BrowserWindow：

- `transparent: true`、`frame: false`、`resizable: false`、`hasShadow: false`
- `alwaysOnTop` 提升到 `screen-saver` 层级
- `setIgnoreMouseEvents(true, { forward: true })` 实现鼠标穿透（Windows 上 forward 保留悬停事件）
- `focusable: false`、`skipTaskbar: true`，不抢焦点、不占任务栏
- 内容为打包的本地 HTML（显示频道名、成员头像/名字、说话高亮、静音/聋状态），不含远程内容、无通用 preload

数据流：Web 页面经版本化 Overlay Bridge（沿用 application-audio Bridge 的 sender/顶层 frame/Origin 校验模式）把成员与说话状态增量推给 Main，Main 转发给 Overlay 窗口渲染。

优点：

- 无注入、无 Hook，**不触发反作弊**，无签名/杀软问题。
- 实现与当前壳的既有模式一致，不需要原生模块和 utilityProcess。
- 兼容后续互动形态（热键切换穿透后支持拖动、点击）。

缺点（平台限制，见下节）：

- Windows 独占全屏游戏下不可见。
- Linux Wayland 下不可行。
- OBS 等录制软件用**游戏源**捕获时看不到 Overlay（游戏源基于交换链捕获，透明窗口不在其中）；只有显示器捕获可见。这是相对 Discord 注入方案的产品差异。

### 方案 B：D3D/OpenGL 注入 Hook（否决）

原生 DLL 注入游戏进程并 Hook Present 调用，绘制到游戏交换链。Discord 路线。

否决理由：

- 需支持 D3D9/D3D11/D3D12/Vulkan 与 32/64 位多种组合，复杂度是方案 A 的一个数量级以上。
- 注入型 Overlay 会被 EAC/BattlEye/Vanguard 等反作弊标记；小项目没有任何被白名单化的渠道，用户会因此被游戏封禁，产品风险不可接受。
- 需要代码签名缓解杀软误报，且仅限 Windows。
- 与项目"薄壳、不做原生运行时"的既定方向冲突。

## 平台可行性

| 平台 | 窗口化/无边框全屏 | 独占全屏 | 说明 |
| --- | --- | --- | --- |
| Windows 10/11 | ✓ | ✗ | DWM 始终合成，透明置顶窗口可靠叠放；现代游戏默认全屏优化/无边框，覆盖率实际很高 |
| Linux X11 | ✓（大多数合成 WM） | 部分 | 依赖 WM 对 always-on-top 与全屏窗口的合成行为，经验值参差 |
| Linux Wayland | ✗ | ✗ | 无通用合成器协议允许普通 Surface 叠在全屏 Surface 之上；仅 KDE/wlroots 支持 wlr-layer-shell，Chromium 不暴露该协议，需原生 helper，首期不做 |

结论：**Windows 是主战场且完全可行；Linux X11 尽力支持；Wayland 与独占全屏列为明确不支持项**（与 Discord Linux 无 Overlay 的现状一致）。

## 产品决策点（已定稿）

1. **后台运行形态**：浮层不影响主窗口——不自动最小化、不联动窗口管理。用户自行在游戏前台前最小化主窗口；浮层常驻并覆盖在游戏画面上。不提供全局热键，首期只在设置中提供开关。
2. **显示内容**：只读展示——频道名 + 语音参与者（头像、显示名、说话高亮、静音/聋标记，含自己）。不做互动。
3. **持久化**：开关作为 Web 端"客户端偏好"存入本地（桌面独立 Session 的 localStorage）；浮层位置固定、不持久化，壳层 config.json 不变。

浮层开启后对其他窗口（非游戏）也可见，不做目标窗口焦点检测——与"无热键、常驻"约束一致。

## 语音浮层桥协议

> 协议定稿：2026-08-01。桌面壳与 Web 页面两仓实现均以本章节为唯一契约，不得自行解释；实现时两仓代码中的协议常量必须与此一致。

### 通道与版本

- 协议号 `VOICE_OVERLAY_PROTOCOL = 1`。
- 能力声明：单个能力 `voice_overlay`；握手返回缺少该能力时 Web 端视为不可用。
- 桥入口：preload 向远程页面暴露 `window.desktopVoiceOverlay`；浏览器环境无该入口，Web 端应隐藏开关。

### 消息

| 方向 | 通道 | 语义 |
| --- | --- | --- |
| Web → Shell | `voice-overlay:hello`（invoke） | 握手：入参 `{minProtocol, maxProtocol}`，返回 `{protocol, capabilities}`；协议号不匹配或能力缺失视为不可用 |
| Web → Shell | `voice-overlay:set-enabled`（invoke） | 启停：入参 `{enabled: boolean}`；壳层据此创建/销毁浮层窗口 |
| Web → Shell | `voice-overlay:state`（单向推送） | 全量状态快照 `VoiceOverlayState` |

### 类型形状

```ts
interface VoiceOverlayState {
  channel: { name: string } | null   // null 表示未连接语音（空态）
  participants: VoiceOverlayParticipant[]
}

interface VoiceOverlayParticipant {
  identity: string          // LiveKit identity，参与者唯一键
  name: string              // 显示名
  avatarUrl: string | null  // 服务器头像资源；浮层窗口直接以 <img> 加载
  isLocal: boolean          // 是否本人
  speaking: boolean         // 说话状态
  microphoneMuted: boolean  // 麦克风静音
  deafened: boolean         // 聋
}
```

### 会话收敛规则（协议不变量）

1. Web 页面每次加载或桥重连后，必须先 `hello`；hello 成功后壳层丢弃此前全部浮层状态，等待新快照。Web 随后至少推送一次全量快照（真实状态或空态）。
2. `setEnabled` 决定浮层窗口存在与否；页面重载、切换服务器后，Web 以持久化偏好重发 `setEnabled`，壳层以最新消息为准。
3. `state` 是幂等全量快照，不设计增量协议，也不携带 revision——一致性由 hello 收敛边界与单 renderer IPC 有序性保证。
4. 节流：说话切换等高频变化由 Web 端合并到 100ms 窗口内推送最新全量快照；成员进出、静音/聋变化、频道切换即时推送。任意时刻推送间隔不小于 100ms。
5. 退出语音立即推送空态（`channel: null`、`participants: []`）；关闭开关推送 `setEnabled(false)` 并停止推送。

### 安全

三个通道均执行与 application-audio 相同的信任校验：sender 必须为当前远程窗口的 webContents、顶层 frame、URL Origin 与当前服务器 Origin 一致。校验失败：`hello`/`setEnabled` 拒绝（invoke 抛错），`state` 丢弃并记日志。

### 实现注记

- 浮层窗口加载头像资源时使用与远程窗口相同的持久分区，共享会话 Cookie；纯 `<img>` 加载不需要 CORS。
- 浮层窗口内容为本地打包页面，不加载远程 HTML，不暴露通用 preload。

## 工作量估算

- 桌面壳：Overlay 窗口管理、IPC 转发、热键、配置持久化、测试——与 application-audio 体量相当或略低（无原生模块、无 utilityProcess）。
- Web 端：Overlay Bridge 模块订阅 voice store 推送增量——小。
- 集成测试：Linux 可在 X11 下跑窗口创建与 IPC 校验；Windows 独占全屏限制靠文档约束。

## 结论

采用**方案 A（透明置顶穿透窗口）**，数据源来自 Web 页面的语音状态推送。可行，代价集中在两处：平台限制（独占全屏、Wayland）需要文档明确不支持；OBS 游戏源捕获不到浮层是产品差异而非缺陷。方案 B（注入）明确否决。

首期范围：Windows + Linux X11、只读展示、开关位于 Web 用户设置面板客户端偏好区、固定左侧居中 32px、无热键无拖动、开关即常驻 + 空态。
