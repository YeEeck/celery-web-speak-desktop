export interface RemoteRequestContext {
  activeRemote: boolean
  senderMatches: boolean
  topFrame: boolean
  senderUrl: string
  serverUrl: string
}

export function isTrustedRemoteRequest(context: RemoteRequestContext): boolean {
  if (!context.activeRemote || !context.senderMatches || !context.topFrame) return false
  try {
    return new URL(context.senderUrl).origin === new URL(context.serverUrl).origin
  } catch {
    return false
  }
}
