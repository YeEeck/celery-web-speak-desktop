# 01 — 语音浮层桥协议定稿

**What to build:** 在语音浮层设计文档中定稿桌面壳与 Web 页面之间的桥协议，作为两个仓库独立实现的唯一契约。协议内容必须足够具体：通道与握手方式（沿用现有应用音频桥的 min/max 协议号握手与能力声明模式）、启停控制消息、状态快照消息（频道名与参与者列表的字段形状）、增量事件（说话切换、成员进出、静音与聋变化）以及更新节流/合并约定。定稿后任何一侧的实现都只依据该章节进行，不得自行解释协议。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] 设计文档新增桥协议章节，覆盖握手、能力声明、启停、快照与增量消息的完整形状
- [x] 协议版本号与能力名确定，两仓代码中均使用同一常量
- [x] 协议涵盖"未连接语音"空态与断连后状态清空的语义
- [x] 浏览器（无桥）环境下的检测与开关隐藏语义在协议中明确

## Answer

协议已定稿于 `docs/game-overlay-design.md` 的「语音浮层桥协议」章节：协议号 `VOICE_OVERLAY_PROTOCOL = 1`、单一能力 `voice_overlay`、preload 入口 `window.desktopVoiceOverlay`、三个通道（`voice-overlay:hello`/`voice-overlay:set-enabled`/`voice-overlay:state`）、`VoiceOverlayState`/`VoiceOverlayParticipant` 类型形状、5 条会话收敛不变量、安全校验要求与头像加载注记。

与票据原文的两处偏离（均已在协议章节明确）：

1. **无增量事件协议**——状态消息统一为幂等全量快照，不用增量事件类型；高频变化由 Web 端 100ms 窗口合并推送。简化一致性模型，避免两侧各做 diff。
2. **无 revision 字段**——一致性由 hello 收敛边界 + 单 renderer IPC 有序性保证，不携带修订号。

两仓代码中的协议常量在 02（桌面端）与 03（Web 端）实现时按本章节落码。
