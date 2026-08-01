# 语音浮层采用透明置顶窗口而非进程注入

语音浮层（游戏内语音状态叠加展示）的实现路线为 Electron 透明置顶穿透窗口（KOOK 同路线），否决 Discord 式原生 DLL 注入与 D3D/Vulkan Present Hook：注入方案对反作弊系统高风险、需按渲染 API 分别实现、仅限 Windows，且与本项目"薄壳、不引入原生语音运行时"的方向冲突；透明窗口无注入、不触发反作弊，代价是独占全屏游戏下不可见、Linux Wayland 下不可行、OBS 游戏源捕获不到浮层。平台范围为 Windows 与 Linux X11，Wayland 明确不支持。
