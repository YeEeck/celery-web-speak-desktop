# 02 — 桌面端浮层窗口与桥接收

**What to build:** 桌面壳完整实现语音浮层管线：远程页面 preload 暴露桥客户端（沿用应用音频桥的 sender、顶层 frame 与服务器 Origin 校验模式）；主进程接收握手与状态消息后创建/销毁浮层窗口；浮层为无边框透明窗口，置顶、跳过任务栏、不抢焦点、鼠标全程穿透，固定左侧垂直居中、距窗口边缘 32px，不随主窗口联动；窗口内本地渲染"未连接语音"空态与完整状态（频道名 + 参与者头像、显示名、说话高亮、静音/聋标记）。集成测试以模拟桥消息驱动整条管线，验证窗口创建、内容渲染、状态增量与销毁。验收时可用模拟消息演示浮层从空态到完整列表再到关闭的完整表现。

**Blocked by:** 01 — 语音浮层桥协议定稿

**Status:** resolved

- [x] preload 桥客户端握手与校验通过（非法 sender/Origin 拒绝）
- [x] 启停消息正确创建/销毁浮层窗口，窗口属性符合设计（透明、置顶、穿透、无焦点、固定位置）
- [x] 空态与完整状态渲染正确，说话/静音/聋变化实时更新
- [x] 集成测试覆盖握手、快照、增量与销毁；TypeScript 类型检查与既有测试通过
- [x] Linux X11 下浮层窗口行为正常，Windows 平台行为不回归

## Answer

已实现并提交到 feat/overlay。交付物：

- `src/shared/voice-overlay-api.ts`：协议常量、`VoiceOverlayState`/`VoiceOverlayParticipant` 类型、`normalizeVoiceOverlayState`/`normalizeVoiceOverlayEnabledRequest` 校验（29 个共享层单测）。
- `src/preload/remote-bridges.cts`：由 application-audio.cts 改名并合并语音浮层桥（`window.desktopVoiceOverlay`：hello/setEnabled/pushState），Web 侧既有 API 名不变。
- `src/preload/overlay.cts` + `src/renderer/overlay.{html,css,js}`：浮层本地渲染页，空态/频道名/参与者（说话高亮、静音、聋图标、本地"（你）"标记），启动时拉取当前状态避免订阅前丢消息。
- `src/main/voice-overlay.ts`：`VoiceOverlayCoordinator`——三通道 IPC（hello/setEnabled/state）+ 浮层窗口生命周期（透明、置顶 screen-saver、跳任务栏、无焦点、鼠标穿透、固定左中 32px、复用远程持久分区）；主 frame 导航/渲染进程退出时清空状态。
- `src/main/remote-request-policy.ts`：从 application-audio-policy 提取的共享信任校验（改名，行为不变，既有 6 例测试保留）。
- e2e：`语音浮层：握手、启停、状态渲染与销毁`——握手能力、子框架无桥、窗口属性（置顶/位置）、快照渲染、说话增量、空态、销毁。

实现偏离（已按评审修复）：

1. **渲染竞态**：状态在渲染器订阅前到达会被丢弃，浮层页启动时先 `getState()` 拉当前状态再订阅（menu 页同款模式）。
2. **窗口尺寸固定 280x420**：无内容自适应，避免主进程查询渲染尺寸的往返。

全量验证：92 单测 + 3 e2e 通过，typecheck 干净。Windows 实机验收留给 04 票据。
