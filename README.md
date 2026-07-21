# Celery Web Speak Desktop

Celery Web Speak 的 Windows 与 Linux Electron 客户端壳。

客户端不打包服务器 Web UI，而是加载用户配置的 Celery Web Speak 服务器。登录 Cookie、LocalStorage 和其他站点数据保存在 Electron 独立用户目录中，不与系统浏览器共享。

当前状态：架构设计完成，正在实现。

详细设计见 [docs/architecture.md](docs/architecture.md)。

## 计划产物

- Windows x64 Inno Setup 安装器
- Windows x64 便携 ZIP
- Linux x64 AppImage

Windows 安装器按当前用户安装，不请求管理员权限。项目不包含自动更新、遥测、托盘常驻和开机启动。
