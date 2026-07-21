# Celery Web Speak Desktop Windows 应用音频设计

> 状态：v0.2.3 已实现，待 Windows 实机矩阵验收。
>
> 设计日期：2026-07-21。
>
> 当前桌面实现基线：v0.2.3。

## 文档边界

跨服务端、Web 与桌面客户端的产品规则、LiveKit 权限、音轨语义和完整状态机以主仓库的 [应用背景音设计](https://github.com/YeEeck/celery-web-speak/blob/main/docs/background-audio-design.md) 为准。

本文只定义 `celery-web-speak-desktop` 的 Windows 原生采集、Electron Bridge、本地选择器、进程隔离、构建和测试边界。两份文档冲突时，产品行为以主仓库文档为准，桌面实现细节以本文为准；实施前必须先消除冲突，不能由客户端静默选择一种语义。

## 背景

当前桌面客户端是薄 Electron 壳。服务器托管的 Vue 页面运行在独立 `WebContentsView` 中，继续使用 Web `livekit-client` 连接语音；远程页面只加载应用音频专用 preload，不能访问通用 Electron 或 Node API。

Chromium 不能可靠地只捕获选定 Windows 应用窗口的音频。Electron 的系统音频 loopback 同样不能提供进程隔离。Windows WASAPI Process Loopback 可以按目标 PID 及其子进程捕获音频，因此本设计增加一个 Windows x64 N-API 模块，并把它放在 Electron `utilityProcess` 中运行。

## 目标

- 使用 Electron 本地模态窗口让用户主动选择一个应用窗口。
- 从 `DesktopCapturerSource.id` 取得并校验 `HWND`，再解析目标 PID。
- 在 Windows 10 2004 及以上使用 WASAPI Process Loopback 捕获目标进程树。
- 通过 `utilityProcess` 隔离原生模块故障，原生崩溃不得退出主应用。
- 通过可转移 `MessagePort` 把 48 kHz 立体声 PCM 送到远程 WebContents。
- 只向当前服务器顶层页面暴露固定、版本化的应用音频 Bridge。
- 不让候选窗口信息跨越 Electron 本地可信边界。
- 保持 Linux 客户端构建、包体和运行行为不变。

## 非目标

- 不在 Electron Main 进程中直接加载采集模块。
- 不分发独立 helper.exe。
- 不安装驱动、虚拟声卡、系统服务或开机启动项。
- 不注入或 Hook 目标进程。
- 不使用全系统 loopback 作为失败回退。
- 不在桌面 Main 或 utilityProcess 中连接 LiveKit。
- 不由原生模块编码 Opus、混音麦克风或控制远端音量。
- 不在 Linux 构建中编译或打包 Windows `.node` 模块。
- 不实现单个浏览器标签页或单个 HWND 内部音频隔离。

## 已确认决策

| 决策项 | 结论 |
| --- | --- |
| 平台 | Windows x64 |
| 最低版本 | Windows 10 2004 Build 19041，运行时探测最终决定能力 |
| 窗口枚举 | Electron `desktopCapturer.getSources({ types: ['window'] })` |
| 音频边界 | 所选 HWND 对应 PID 及其子进程 |
| 原生接口 | WASAPI Process Loopback |
| 原生封装 | Node-API/N-API Windows x64 `.node` 模块 |
| 进程承载 | Electron `utilityProcess` |
| PCM 传输 | 可转移 `MessagePort` + 结构化克隆 `ArrayBuffer` |
| PCM 格式 | 48 kHz、双声道、32-bit float |
| Web 接入 | 受限 remote preload + DOM MessagePort |
| LiveKit | 仍由服务器 Vue 页面中的 `livekit-client` 发布 |
| 原生故障 | 停止背景音并报告稳定错误，主应用继续运行 |

## 总体结构

```text
+-------------------------- BrowserWindow ---------------------------+
|                                                                     |
| local shell WebContents                                             |
|                                                                     |
| remote WebContentsView                                              |
|   restricted application-audio preload                              |
|   server-hosted Vue / AudioWorklet / LiveKit                        |
+---------------------------|-----------------------------------------+
                            | commands / snapshots / PCM MessagePort
                            v
+---------------------- Electron Main Process -----------------------+
| ApplicationAudioCoordinator                                         |
|   sender + Origin validation                                        |
|   one-session ownership                                             |
|   source picker                                                      |
|   utilityProcess lifecycle                                          |
+---------------------------|-----------------------------------------+
                            | HWND + control port
                            v
+------------------------- utilityProcess ---------------------------+
| application-audio worker                                            |
|   N-API module                                                       |
|   COM / WASAPI capture thread                                       |
|   native bounded ring buffer                                        |
|   process and HWND monitoring                                       |
+---------------------------|-----------------------------------------+
                            v
             target PID and child render streams
```

Main 是应用音频会话的唯一所有者。远程页面、选择器窗口和 utilityProcess 都不能独立创建第二个会话。

## 当前架构变化

### Remote WebContentsView

v0.2.2 的远程 `WebContentsView` 只加载应用音频专用 preload，同时保持：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
```

这不是向远程页面开放通用 Electron 能力。preload 只能使用固定应用音频 IPC 通道，不导出 `ipcRenderer`、Node 对象、文件系统、进程、Shell、窗口管理或任意通道调用。

同 Origin `window.open` 创建的额外窗口继续不加载该 preload。应用音频能力只属于主远程 `WebContentsView` 的顶层 frame。

### Main Process

Main 增加 `ApplicationAudioCoordinator`，负责：

- 能力探测结果缓存。
- IPC sender、frame 与 Origin 校验。
- 打开和关闭本地来源选择器。
- 校验选择器返回的 source ID。
- 维护唯一 capture `sessionId` 与 revision。
- 创建、监督和终止 utilityProcess。
- 在 utilityProcess 与远程 WebContents 间转交 MessagePort。
- 处理远程页面 reload、navigation、render-process-gone 和窗口销毁。
- 把底层错误映射为不含目标身份的稳定错误码。

Main 不读取、分析或持久化 PCM。

### utilityProcess

utilityProcess 只负责一个采集会话：

- 加载 Windows N-API 模块。
- 对 HWND 和目标 PID 做最终校验。
- 初始化 COM 与 Process Loopback。
- 管理原生采集线程和缓冲区。
- 接收 pause、resume、stop 控制。
- 把 PCM block 发送到已转交的 MessagePort。
- 监控 HWND 销毁、目标进程退出和采集错误。
- 退出前停止 IAudioClient、释放 COM 对象并清空缓冲。

utilityProcess 不获得当前服务器 URL、Cookie、账号资料或 LiveKit Token，不发起网络请求。

## 目录规划

```text
native/
  application-audio/
    binding.gyp
    src/
      addon.cpp                 N-API 导出与线程安全事件边界
      process-loopback.cpp      WASAPI Process Loopback
      process-loopback.hpp
      session-monitor.cpp       HWND/PID 生命周期
      session-monitor.hpp
src/
  main/
    application-audio.ts        会话协调、sender 校验、worker 生命周期
    application-audio-picker.ts 本地选择器与 source 校验
  preload/
    application-audio.cts       远程页面唯一新增 preload
  renderer/
    application-audio-picker.*  本地来源选择器页面
  shared/
    application-audio-api.ts    Bridge、快照、错误与消息类型
  utility/
    application-audio-worker.ts utilityProcess 入口
scripts/
  build-native.mjs              仅 Windows 编译 N-API 模块
tests/
  fixtures/
    audio-source/               Windows 可控测试音源
```

文件名可以在实施时按仓库模式微调，但模块边界不得把窗口候选数据或通用 Electron API 暴露给远程页面。

## 本地来源选择器

### 来源获取

Main 调用：

```ts
desktopCapturer.getSources({
  types: ['window'],
  fetchWindowIcons: true,
  thumbnailSize: { width: 320, height: 180 },
})
```

只允许 `window:` source，不请求 `screen`。每次打开选择器重新获取快照，不持久化历史来源。

Windows 上 source ID 格式为：

```text
window:<HWND>:<other_id>
```

Main 使用严格解析器取得 HWND。解析结果必须是正整数的十进制字符串，且来源仍存在于本次 `getSources` 返回集合中。JavaScript 层不得先把 64 位 HWND 转为 `number`；utilityProcess 将原始十进制字符串交给 N-API，由原生层按指针宽度解析。远程页面不能提供、修改或重放 source ID。

### 过滤

排除：

- 主远程窗口、本地壳窗口、设置窗口、菜单窗口和来源选择器自身。
- Electron 所有已知本地 BrowserWindow 的 media source ID。
- source ID 无法严格解析的条目。
- 缩略图和标题都为空且无法向用户识别的无效来源。

不根据窗口标题字符串过滤自身窗口，避免同名窗口绕过。

### 界面

选择器是主窗口的本地模态 `BrowserWindow`：

- 使用打包的本地 HTML、CSS 和 preload。
- 以网格展示窗口缩略图、应用图标和窗口标题。
- 标题过长时省略，不改变固定缩略图尺寸。
- 提供取消与“共享音频”操作。
- 双击来源等价于选中后确认。
- 来源列表为空时显示本地错误状态与刷新操作。
- 选择器关闭等价于取消，不报告错误通知。

候选列表只进入本地选择器 renderer。选择完成后 Main 只向远程页面返回通用状态，不返回 title、name、thumbnail、appIcon、HWND、PID 或 executable path。

## Bridge 与 IPC

### 通道分组

概念通道如下，实际常量集中在 `src/shared/application-audio-api.ts`：

```text
application-audio:hello
application-audio:get-snapshot
application-audio:start
application-audio:pause
application-audio:resume
application-audio:stop
application-audio:snapshot
application-audio:pcm-port
```

远程页面调用 start 时不能携带目标标识。Main 收到请求后才打开本地选择器。

### Sender 校验

每个 Main handler 必须同时验证：

- sender 等于当前活动 remote WebContents。
- 消息来自顶层 frame，而不是子 frame。
- sender 当前 URL 可以解析。
- sender URL 的 Origin 严格等于当前配置服务器 Origin。
- 当前窗口处于远程模式且没有被替换或销毁。
- sessionId 与当前 Main 会话一致。

校验失败直接拒绝，不打开选择器、不启动 utilityProcess，也不向不受信页面泄露能力详情。

### Preload API

preload 在 main world 暴露只读 `desktopApplicationAudio`：

```ts
interface DesktopApplicationAudio {
  hello(input: ProtocolRange): Promise<ApplicationAudioCapabilities>
  getSnapshot(): Promise<ApplicationAudioSnapshot>
  start(): Promise<ApplicationAudioSnapshot>
  pause(sessionId: string): Promise<ApplicationAudioSnapshot>
  resume(sessionId: string): Promise<ApplicationAudioSnapshot>
  stop(sessionId: string): Promise<ApplicationAudioSnapshot>
  onSnapshot(listener: (snapshot: ApplicationAudioSnapshot) => void): () => void
}
```

回调只接收经过结构化克隆的普通对象。preload 不把 Electron event、sender、IPC channel 或原生对象传入 main world。

### PCM Port

PCM 不经过 `contextBridge` 回调或高频 invoke/send：

1. Main 创建 MessageChannel。
2. 一个 port 转交给 utilityProcess。
3. 另一个 port 通过 `webContents.postMessage` 发送给 remote preload。
4. preload 按 sessionId 暂存收到的端口，并在对应快照到达后把 DOM MessagePort 转交给当前页面；不能假设 `start()` 的 invoke 返回和 `pcm-port` IPC 事件有固定到达顺序。
5. Web AudioWorklet 消费 port 中带 sessionId 和序号的 `ArrayBuffer`。

Electron 43 的 `MessagePortMain.postMessage` transfer list 只接受 `MessagePortMain`，不能转移
`ArrayBuffer` 所有权；传入其他 transferable 会被 Electron 绑定层拒绝。因此 Main 把 port 一次性
转交后，utilityProcess 直接向远程 DOM port 发送 PCM，`ArrayBuffer` 在 Electron structured clone
中复制一次。Main 不接收或读取 PCM。固定格式的复制带宽约为 384 KB/s，实机长时间测试需继续
验证消息频率、欠载和爆音；如果该复制成为瓶颈，后续必须通过独立共享内存协议解决，不能假定
Electron 支持未公开的 ArrayBuffer transfer 行为。

remote preload 使用当前页面 Origin 调用 `window.postMessage`，固定消息为：

```ts
{
  type: 'celery:application-audio:pcm-port'
  protocol: 1
  sessionId: string
}
```

页面从对应 `MessageEvent.ports[0]` 取得唯一 PCM port，并同时校验 `event.source === window`、
`event.origin === window.location.origin`、协议版本与当前 `sessionId`。同一 session 的重复 port 必须关闭。

每个 PCM block 至少包含：

```ts
interface ApplicationAudioPcmBlock {
  sessionId: string
  sequence: number
  frames: number
  channels: 2
  sampleRate: 48000
  data: ArrayBuffer
}
```

停止或替换会话时关闭两端 port。任何旧 sessionId 的 PCM block 必须丢弃，不能进入新 AudioWorklet。

## utilityProcess 协议

Main 到 worker：

```text
probe
start { sessionId, hwndDecimal, pcmPort }
pause { sessionId }
resume { sessionId }
stop { sessionId }
shutdown
```

worker 到 Main：

```text
ready
probe_result
started
paused
resumed
stopped
source_destroyed
source_process_exited
capture_error
statistics
```

所有会话消息携带 sessionId。统计消息只包含欠载、过载、丢帧、采样格式和状态计数，不包含目标身份或 PCM 内容。

Main 为 start、pause、resume 和 stop 设置有界超时。worker 无响应时终止 utilityProcess、关闭 ports，并向 Web 报告 `capture_worker_exited` 或 `capture_stream_failed`。

## N-API 模块

### API 边界

原生模块只向 utilityProcess 暴露固定类或函数：

```ts
interface NativeApplicationAudioCapture {
  probe(): NativeProbeResult
  start(options: NativeStartOptions, listener: NativeCaptureListener): void
  pause(): void
  resume(): void
  stop(): void
  snapshot(): NativeCaptureSnapshot
}
```

原生 listener 只在 utilityProcess 中使用。N-API 通过线程安全函数或原生环形缓冲把数据交给 Node 线程；WASAPI 实时线程不能直接执行 JavaScript、分配无界对象或等待 MessagePort。

### 能力探测

探测步骤：

1. 确认系统为 Windows x64。
2. 读取真实 Windows Build，低于 19041 返回 unsupported。
3. 动态加载 `mmdevapi.dll`。
4. 动态解析 `ActivateAudioInterfaceAsync`。
5. 验证 Process Loopback 所需结构和虚拟设备路径可初始化。
6. 返回稳定 capability，不把 HRESULT 暴露给远程页面。

不能仅因为版本大于 19041 就报告支持。微软文档标注比 OBS 实际支持范围更保守，因此初始化探测是最终依据。

### WASAPI 初始化

采集使用：

```text
AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
```

初始化要求：

- utilityProcess 中的原生工作线程初始化 COM。
- 目标 PID 必须由传入 HWND 重新解析，不能信任 Main 传入的独立 PID。
- 输出格式请求 48 kHz、2 channel、32-bit IEEE float。
- 使用共享模式与 event callback 驱动采集。
- 对 silent buffer 显式写入零值。
- 捕获循环检查停止信号、目标进程和 HWND 生命周期。
- 所有 COM、event handle、线程和缓冲在 stop 与析构路径幂等释放。

如果系统不接受目标格式，原生层可以使用系统支持的格式采集后在 utilityProcess 内转换为固定 48 kHz stereo float；不能把可变格式直接推给 Web。

### 生命周期判断

停止条件：

- `IsWindow(hwnd)` 变为 false 或收到可靠的窗口销毁事件。
- 目标 PID 退出。
- IAudioClient 或 IAudioCaptureClient 返回不可恢复错误。
- Main 发出 stop/shutdown。
- utilityProcess 父端断开。

以下情况继续：

- `IsIconic(hwnd)` 为 true。
- `IsWindowVisible(hwnd)` 为 false，但 HWND 与 PID 仍有效。
- DWM cloaked、失焦、被遮挡或位于其他虚拟桌面。

不能把 `IsWindowVisible == false` 当作停止条件，因为最小化到托盘已确认需要继续采集。

## 会话生命周期

### 开始

```text
Web start()
  -> Main validates sender and capability
  -> Main opens local source picker
  -> user chooses source
  -> Main validates source and creates sessionId
  -> Main starts utilityProcess and transfers control/PCM port
  -> worker resolves HWND -> PID and starts WASAPI
  -> worker reports started
  -> Main sends PCM port and snapshot to remote preload
  -> Web builds AudioWorklet track and publishes LiveKit
```

如果 Web 最终发布 LiveKit 失败，应调用 stop 释放 native session。Main 也设置 starting 超时，防止 Web 在取得 PCM port 后无响应造成孤儿采集。

### 暂停与继续

- pause 停止或挂起 IAudioClient 读取，保留目标、worker、ports 和 sessionId。
- 暂停后不得持续向 PCM port 发送零块占用 IPC。
- resume 重新启动同一 IAudioClient；如果目标已失效，转为停止事件。
- 重复 pause、resume 对当前目标状态幂等。

### 停止

Main 的 stop 顺序：

1. 把会话标记为 stopping，拒绝新的 pause/resume。
2. 通知 worker 停止 WASAPI。
3. 关闭 PCM ports。
4. 等待有界时间后终止未退出 worker。
5. 清除 sessionId、revision 和本地引用。
6. 向 Web 发送最终 idle 或 error 快照。

页面 reload、导航、render-process-gone、切换服务器、远程窗口销毁和应用退出均进入相同清理路径。清理必须幂等。

## 错误与日志

Main 把原生 HRESULT 和异常映射为主设计定义的稳定错误码。日志允许记录：

- capability probe 成功或失败及稳定原因。
- capture session 状态迁移。
- utilityProcess spawn、exit 和 timeout。
- utilityProcess 能力探测失败时记录启动阶段、退出码或超时类别；不得记录子进程环境变量值。
- PCM block、欠载、过载和丢帧计数。
- 清理是否完成。

日志禁止记录：

- source name、窗口标题和应用名称。
- HWND、PID、可执行文件路径或命令行。
- PCM 数据、音频摘要或可恢复的媒体内容。
- server Cookie、LiveKit Token 或远程页面消息正文。

原生错误消息不能直接显示给用户。开发日志可以记录 HRESULT 的十六进制值，但同一记录不得包含目标身份。

## 构建与打包

### 原生构建

- 使用 Node-API，避免依赖 V8 私有 API。
- Windows runner 使用已安装的 MSVC 与 Windows SDK 构建 x64 `.node`。
- 原生模块必须与仓库 GPL-3.0-only 许可证兼容；优先基于 Microsoft 示例和公开 API 自行实现，不直接复制依赖 OBS 内部类型的代码。
- 构建脚本在非 Windows 平台不调用 node-gyp/MSBuild。
- TypeScript 类型通过本地 `.d.ts` 描述，Linux typecheck 不需要加载二进制。

### electron-builder

- Windows build 在 TypeScript 构建前或后明确执行 native build，并把产物复制到稳定 `dist/native/win32-x64/` 路径。
- `.node` 必须位于 ASAR 外或配置 `asarUnpack`，保证 utilityProcess 可以加载。
- Windows unpacked、ZIP 与 Inno 安装器均验证二进制存在。
- 发布构建必须实际启动打包产物内的 utilityProcess 入口并完成 `ready -> probe_result` 握手；仅检查 `.node` 文件存在不足以证明 worker 可运行。
- Linux `dist` 不包含 Windows `.node`，能力探测固定返回 unsupported，现有 AppImage 构建不安装 MSVC 依赖。
- package 脚本不能让 Linux `npm ci` 执行 Windows-only install hook。

### 发布顺序

服务端/Web 先发布 Bridge 适配和默认隐藏入口，Windows 桌面客户端后发布。桌面客户端连接旧服务器时，旧 Web 不调用 Bridge；新服务器连接旧桌面客户端时，因能力缺失隐藏入口。

## 测试策略

### TypeScript 单元测试

- source ID 严格解析与非法输入拒绝。
- 自身窗口过滤不依赖标题。
- sender、top frame、Origin 和 remote mode 校验。
- sessionId/revision 旧消息丢弃。
- start/pause/resume/stop 幂等与超时。
- reload、navigation、worker exit 和窗口关闭进入统一清理。
- 快照与错误不包含目标身份字段。
- 非 Windows capability 固定缺失。

### N-API 与 Windows 集成测试

构建 Windows 测试音源 fixture，分别产生已知频率：

- 目标进程输出左/右声道可识别正弦波。
- 无关进程同时输出不同频率。
- 子进程输出第三个频率。

断言：

- 捕获包含目标与子进程频率。
- 捕获不包含无关进程频率。
- PCM 为 48 kHz stereo float 且持续时间正确。
- pause 停止输出，resume 恢复同一来源。
- 目标窗口销毁或进程退出后稳定停止。
- 最小化、隐藏和失焦不停止。
- stop 后没有迟到 block。
- utilityProcess 强制崩溃时主 Electron 应用保持运行。

### Electron 集成测试

- 支持环境下 Bridge hello 返回协商版本与 capability。
- 普通远程子 frame、弹窗和跨 Origin 页面不能调用 Bridge。
- 本地选择器只包含窗口来源并排除自身窗口。
- 取消选择不产生错误状态。
- 候选窗口信息不会传到远程测试页面。
- PCM port 只转交一次且绑定当前 sessionId。
- remote reload、切换服务器和关闭窗口终止 worker。
- Linux E2E 保持当前远程页面行为且不暴露 capability。

### 实机验收

- Windows 10 22H2 Build 19045。
- 当前 Windows 11 稳定版。
- Inno 安装版和便携 ZIP。
- 普通播放器、Chrome/Edge、GPU 应用和至少一个游戏。
- 输出设备切换、最小化、托盘隐藏和 LiveKit 网络重连。
- 目标应用不兼容时安全失败且不采集系统音频。

## 实施顺序

1. 提交本文档并同步主仓库跨端设计。
2. 建立 Windows 测试音源与最小 N-API probe/capture 原型。
3. 验证 Windows 10 19045 和 Windows 11 的进程隔离。
4. 实现 utilityProcess、控制协议和 PCM MessagePort。
5. 实现受限 remote preload、Main sender 校验和快照。
6. 实现本地来源选择器与 HWND 校验。
7. 与主仓库 AudioWorklet 和 LiveKit publication 联调。
8. 补齐故障、生命周期、自动化和实机矩阵。
9. 验证 Windows 安装产物和 Linux AppImage 回归。

原型阶段必须优先证明“目标进程 PCM 正确且无关进程不进入”以及“utilityProcess 到 AudioWorklet 长时间无爆音”。在这两项通过前不投入完整来源选择器视觉实现。

## 主要风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Windows 19041-20347 的官方文档支持标注保守 | 某些系统初始化失败 | 运行时探测、19045 实机和稳定错误 |
| 原生实时线程阻塞或内存错误 | 爆音或 worker 崩溃 | 有界缓冲、线程安全函数、utilityProcess 隔离 |
| PCM MessagePort 抖动 | 欠载、延迟和断续 | 固定 block、序号、两级缓冲和统计 |
| remote preload 扩大安全边界 | 远程页面滥用本地能力 | 固定 API、精确 Origin、top frame、Main 复验、本地选择 |
| source ID/窗口在选择后失效 | 捕获错误进程或启动失败 | 本次列表校验、worker 重新解析 HWND/PID、失败即停止 |
| 多进程应用音频拓扑特殊 | 静音或范围超过单窗口 | 明确进程树语义，不自动切换或系统回退 |
| `.node` 被打进 ASAR 或漏打包 | Windows 正式包无法加载 | asarUnpack、unpacked/ZIP/Inno 产物测试 |
| Windows-only 依赖污染 Linux | AppImage CI 失败 | 条件构建、无 install hook、Linux 无二进制 |

## 完成定义

- Windows 10 19045 与 Windows 11 的进程隔离测试通过。
- 本地来源选择器只列应用窗口并排除自身窗口。
- 远程页面无法读取窗口候选与目标身份。
- Bridge 只允许当前服务器顶层 remote WebContents 调用。
- utilityProcess 故障不退出主应用，且所有 PCM 和原生资源被清理。
- 暂停、恢复、停止、目标退出、窗口销毁、reload 与切换服务器符合主设计。
- Windows unpacked、ZIP 和 Inno 安装器包含可加载的 `.node`。
- Linux typecheck、单元测试、E2E 和 AppImage 构建保持通过且不暴露功能。
- 文档、自动化和实机兼容矩阵与实际行为一致。
