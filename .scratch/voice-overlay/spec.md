# voice-overlay

语音浮层（游戏内语音状态展示）实施票据。

方案定稿见 [docs/game-overlay-design.md](../../docs/game-overlay-design.md)，实现路线决策见 [docs/adr/0001-voice-overlay-transparent-window.md](../../docs/adr/0001-voice-overlay-transparent-window.md)，产品术语见主仓库 CONTEXT.md「语音浮层」词条。

已确认决策摘要：

- 实现路线：透明置顶穿透窗口，否决进程注入。
- 开关：Web 用户设置面板"音频"页，客户端偏好（localStorage），浏览器环境隐藏。
- 显示内容：频道名 + 全部语音参与者（头像、显示名、说话高亮、静音/聋标记，含自己）。
- 位置：固定左侧垂直居中、距窗口边缘 32px；无拖动、无持久化、鼠标全程穿透。
- 生命周期：开关即常驻；未连接语音显示"未连接语音"空态；壳层不感知语音会话。
- 平台：Windows 与 Linux X11；Wayland 明确不支持；不影响主窗口、无全局热键。

## Tickets

1. 01-overlay-bridge-protocol.md — 语音浮层桥协议定稿
2. 02-desktop-overlay-window.md — 桌面端浮层窗口与桥接收
3. 03-web-overlay-toggle-and-push.md — Web 端开关与状态推送
4. 04-e2e-acceptance-and-limits.md — 端到端验收与限制说明
