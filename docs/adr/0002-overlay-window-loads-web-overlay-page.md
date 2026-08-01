# 浮层窗口加载 Web 部署的浮层页面（协议 2）

浮层 UI 迭代此前依赖桌面壳发版，而壳发版成本显著高于 Web。为解耦，浮层渲染页迁至 Web 仓库（独立 Vue 入口 `/overlay.html`），壳的浮层窗口改为加载该远程页面并只承担窗口几何（位置/大小）与数据转发，协议提升至 2 并新增 `voice-overlay:set-config` 通道。壳不再携带本地 overlay 资源：协商结果为协议 1（旧 Web）时浮层整体禁用，新 Web 对旧壳则按协议 1 保持旧行为、配置 UI 隐藏。远程页面不暴露通用 preload，IPC 仅经受信任的 voice-overlay 桥。
