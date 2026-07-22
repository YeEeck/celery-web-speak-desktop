const windowApi = window.desktopWindow
const titlebar = document.querySelector('.window-titlebar')
const menuButton = document.querySelector('[data-window-action="menu"]')
const minimizeButton = document.querySelector('[data-window-action="minimize"]')
const maximizeButton = document.querySelector('[data-window-action="maximize"]')
const maximizeIcon = maximizeButton?.querySelector('[aria-hidden="true"]')
const closeButton = document.querySelector('[data-window-action="close"]')

void windowApi.getState().then((state) => updateMaximized(state.maximized))
const removeMaximizedListener = windowApi.onMaximizedChange(updateMaximized)

menuButton?.addEventListener('click', () => {
  const bounds = menuButton.getBoundingClientRect()
  void windowApi.showMenu({ x: bounds.right, y: bounds.bottom })
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

// 窗口恢复焦点时，强制重新计算标题栏按钮的 hover 状态。
// 最小化期间 mouseup 事件丢失，Chromium 不会合成 mousemove 重新 hit-test，
// 导致 :hover 背景色卡在最小化按钮上。切换 pointer-events 可强制浏览器重新评估。
window.addEventListener('focus', () => {
  const buttons = document.querySelectorAll('.window-titlebar-button')
  for (const button of buttons) button.style.pointerEvents = 'none'
  requestAnimationFrame(() => {
    for (const button of buttons) button.style.pointerEvents = ''
  })
})

window.addEventListener('beforeunload', removeMaximizedListener)

function updateMaximized(maximized) {
  if (!maximizeButton || !maximizeIcon) return
  maximizeButton.setAttribute('aria-label', maximized ? '还原窗口' : '最大化窗口')
  maximizeButton.title = maximized ? '还原' : '最大化'
  maximizeIcon.classList.toggle('restore', maximized)
}
