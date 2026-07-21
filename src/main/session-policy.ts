import { shell, type Session, type WebContents } from 'electron'
import { canGrantPermission, isTrustedOrigin } from './origin-policy.js'

export function configureSessionPolicy(targetSession: Session, serverUrl: string): void {
  targetSession.setPermissionCheckHandler((webContents, _permission, requestingOrigin, details) => {
    const requestingUrl = details.requestingUrl ?? details.securityOrigin ?? requestingOrigin
    const embeddingOrigin = details.embeddingOrigin ?? webContents?.getURL() ?? requestingOrigin
    return canGrantPermission(requestingUrl, embeddingOrigin, serverUrl)
  })

  targetSession.setPermissionRequestHandler((webContents, _permission, callback, details) => {
    const requestingUrl = 'requestingUrl' in details && typeof details.requestingUrl === 'string'
      ? details.requestingUrl
      : webContents.getURL()
    const embeddingOrigin = 'embeddingOrigin' in details && typeof details.embeddingOrigin === 'string'
      ? details.embeddingOrigin
      : webContents.getURL()
    callback(canGrantPermission(requestingUrl, embeddingOrigin, serverUrl))
  })
}

export function configureNavigationPolicy(webContents: WebContents, serverUrl: string, packaged: boolean): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedOrigin(url, serverUrl)) {
      openExternalHttpUrl(url)
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: secureRemoteWindowOptions(),
    }
  })

  webContents.on('will-navigate', (event, url) => {
    if (isTrustedOrigin(url, serverUrl)) return
    event.preventDefault()
    openExternalHttpUrl(url)
  })

  webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && !input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault()
      webContents.reload()
    }
  })

  if (packaged) disableDevTools(webContents)
}

function secureRemoteWindowOptions() {
  return {
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  }
}

function openExternalHttpUrl(value: string): void {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') void shell.openExternal(url.href)
  } catch {
    // Invalid and unknown protocols are ignored.
  }
}

function disableDevTools(webContents: WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase()
    const developerShortcut = input.key === 'F12' ||
      ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key))
    if (developerShortcut) event.preventDefault()
  })
  webContents.on('devtools-opened', () => webContents.closeDevTools())
}
