const windowApi = window.desktopWindow
const titlebar = document.querySelector('.window-titlebar')
const serverUrlElement = document.querySelector('.window-titlebar-url')
const menuButton = document.querySelector('[data-window-action="menu"]')
const updateButton = document.querySelector('[data-window-action="update"]')
const minimizeButton = document.querySelector('[data-window-action="minimize"]')
const maximizeButton = document.querySelector('[data-window-action="maximize"]')
const maximizeIcon = maximizeButton?.querySelector('[aria-hidden="true"]')
const closeButton = document.querySelector('[data-window-action="close"]')

void windowApi.getState().then((state) => {
  updateMaximized(state.maximized)
  updateServerUrl(state.serverUrl)
  updateUpdateButton(state.updateAvailable, state.updateVersion)
})
const removeMaximizedListener = windowApi.onMaximizedChange(updateMaximized)
const removeUpdateListener = windowApi.onUpdateStateChange
  ? windowApi.onUpdateStateChange((state) => {
      updateUpdateButton(state.available, state.version)
    })
  : null

menuButton?.addEventListener('click', () => {
  const bounds = menuButton.getBoundingClientRect()
  void windowApi.showMenu({ x: bounds.right, y: bounds.bottom })
})

updateButton?.addEventListener('click', () => {
  void windowApi.checkUpdate().then((result) => {
    if (result && typeof result.available === 'boolean') {
      updateUpdateButton(result.available, result.version ?? '')
    }
  })
})

minimizeButton?.addEventListener('click', () => {
  minimizeButton.blur()
  void windowApi.minimize()
})

maximizeButton?.addEventListener('click', () => {
  void windowApi.toggleMaximize().then((state) => updateMaximized(state.maximized))
})

closeButton?.addEventListener('click', () => {
  void windowApi.close()
})

titlebar?.addEventListener('dblclick', (event) => {
  if (event.target.closest('.window-titlebar-button')) return
  void windowApi.toggleMaximize().then((state) => updateMaximized(state.maximized))
})

// 用 JS 管理 hover 类名，替代原生 :hover 伪类。
// 最小化期间 mouseup 丢失且 Chromium 恢复窗口时不会重新 hit-test，
// 导致 :hover 卡死。改为类名后，窗口恢复焦点时可直接清除。
const titlebarButtons = document.querySelectorAll('.window-titlebar-button')
for (const button of titlebarButtons) {
  button.addEventListener('mouseenter', () => button.classList.add('hover'))
  button.addEventListener('mouseleave', () => button.classList.remove('hover'))
}

window.addEventListener('focus', () => {
  for (const button of titlebarButtons) button.classList.remove('hover')
  // 窗口获得焦点时重新同步更新状态，防止广播丢失导致按钮状态不一致
  void windowApi.getState().then((state) => {
    updateUpdateButton(state.updateAvailable, state.updateVersion)
  })
})

window.addEventListener('beforeunload', () => {
  removeMaximizedListener()
  removeUpdateListener?.()
})

function updateMaximized(maximized) {
  if (!maximizeButton || !maximizeIcon) return
  maximizeButton.setAttribute('aria-label', maximized ? '还原窗口' : '最大化窗口')
  maximizeButton.title = maximized ? '还原' : '最大化'
  maximizeIcon.classList.toggle('restore', maximized)
}

function updateServerUrl(serverUrl) {
  if (!serverUrlElement || !serverUrl) return
  serverUrlElement.textContent = serverUrl
  serverUrlElement.title = serverUrl
  serverUrlElement.hidden = false
}

function updateUpdateButton(available, version) {
  if (!updateButton) return
  updateButton.hidden = !available
  if (available && version) {
    updateButton.title = `v${version} 可用`
  }
}
