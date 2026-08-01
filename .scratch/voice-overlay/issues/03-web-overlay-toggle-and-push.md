# 03 — Web 端开关与状态推送

**What to build:** Web 页面实现桥客户端与设置开关：启动时进行桥能力检测（无桥能力时隐藏开关，不做任何事）；用户设置面板"音频"页新增"游戏内显示语音浮层"开关，作为客户端偏好持久化在本地，桌面壳中跨重启保留；开关开启后，进入语音即按协议推送状态快照（频道名、参与者及各自状态），说话切换、成员进出、静音与聋变化按增量推送；退出语音与关闭开关时按协议清空/停止推送。浏览器环境与握手失败时开关不可见或明确不可用。单元测试覆盖能力检测、开关持久化与推送状态机。

**Blocked by:** 01 — 语音浮层桥协议定稿

**Status:** resolved

- [x] 无桥能力时开关隐藏，桌面壳中开关可见可持久化
- [x] 开启开关并进入语音后按协议推送完整快照
- [x] 说话切换、成员进出、静音与聋变化按协议推送增量
- [x] 退出语音与关闭开关按协议停止推送并清空状态
- [x] 单元测试覆盖检测、持久化与推送状态机；类型检查与既有测试通过

## Answer

已实现于主仓库（feat/overlay 分支提交）。交付物：

- `web/src/audio/voiceOverlayBridge.ts`：桥客户端——hello 握手（协议号 1 + `voice_overlay` 能力校验）、`setEnabled`、`pushState`；5 个单测（成功/无桥/协议不符/能力缺失/握手异常）。
- `web/src/stores/voice-overlay.ts`：组合模块——偏好持久化（`cws.voiceOverlay.enabled`）、初始化收敛（重发偏好 + 当前快照）、状态构建（频道名 + 参与者映射：头像 URL、`microphoneMuted = !microphoneEnabled`、聋）、说话切换 100ms 合并推送、成员进出/静音/聋/频道变化即时推送、退出语音推空态、关闭开关停止推送；11 个单测。
- `web/src/components/ProfilePanel.vue`：音频页签新增"游戏内显示语音浮层"开关（`v-if="voice.overlaySupported"`，浏览器无桥时隐藏）+ 平台限制提示。
- `web/src/stores/voice.ts`：接线 `useVoiceOverlay` 并暴露 `overlaySupported/overlayEnabled/setOverlayEnabled/initializeVoiceOverlay`；`UserControls.vue` onMounted 初始化。
- `web/src/env.d.ts`：`window.desktopVoiceOverlay` 类型声明。

实现偏离（已按评审修复）：

1. **说话切换等变化的区分**：Vue 深度监听的旧值回调即当前对象，无法用新旧对比判断"紧急变化"；改为参与者快照签名（identity + 麦克风 + 聋），签名变化=成员进出/静音/聋→即时推送，仅说话变化→节流推送。
2. **关闭开关时初始化不推空态**：偏好关闭时初始化只 `setEnabled(false)` 不推送（壳层窗口已销毁，推送无意义）；开启时 `setEnabled(true)` 并立即推送当前状态。该例外已写回设计文档不变量 1。

评审修复清单：`setEnabled` 拒绝未捕获（初始化失败降级为不可用，切换时 catch）；移除测试残留 `nextTick`。桥重连与切换服务器场景由整页重载覆盖（桌面壳切换服务器即重启应用），`initialized` 守卫保证单页生命内只握手一次。

全量验证：102 单测通过（含新增 16 个）、vue-tsc typecheck 干净、vite 构建通过。桌面端桥对端已由 02 票据实现并集成测试覆盖，跨仓合体演示留给 04 票据。
