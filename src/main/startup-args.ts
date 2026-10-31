/**
 * 启动条目写入的命令行参数，由主进程在 app ready 前解析。
 * 只认精确的 `--autostart`：`--autostart=1`、`--no-autostart`
 * 以及路径里恰好包含该字符串的参数都不算。
 */
export const AUTOSTART_FLAG = '--autostart'

export function isAutostartLaunch(argv: readonly string[]): boolean {
  return argv.some((argument) => argument === AUTOSTART_FLAG)
}
