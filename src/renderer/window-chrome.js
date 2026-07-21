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

window.addEventListener('beforeunload', removeMaximizedListener)

function updateMaximized(maximized) {
  if (!maximizeButton || !maximizeIcon) return
  maximizeButton.setAttribute('aria-label', maximized ? '还原窗口' : '最大化窗口')
  maximizeButton.title = maximized ? '还原' : '最大化'
  maximizeIcon.classList.toggle('restore', maximized)
}
