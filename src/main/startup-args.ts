/**
 * 启动条目写入的命令行参数，由主进程在 app ready 前解析。
 * 只认精确的 `--autostart`：`--autostart=1`、`--no-autostart`
 * 以及路径里恰好包含该字符串的参数都不算。
 */
export const AUTOSTART_FLAG = '--autostart'

export function isAutostartLaunch(argv: readonly string[]): boolean {
  return argv.some((argument) => argument === AUTOSTART_FLAG)
}

/**
 * 重启应用时的命令行参数：配置页保存服务器后的重启是用户操作，
 * 不应沿用启动条目写入的 --autostart，否则新进程会再次最小化出现。
 */
export function relaunchArguments(argv: readonly string[]): string[] {
  return argv.slice(1).filter((argument) => argument !== AUTOSTART_FLAG)
}
