const menuApi = window.desktopMenu
const remoteMode = new URLSearchParams(window.location.search).get('mode') === 'remote'
const menuItems = () => [...document.querySelectorAll('.menu-item:not([hidden])')]

document.body.classList.toggle('remote-mode', remoteMode)

for (const item of document.querySelectorAll('[data-menu-action]')) {
  item.addEventListener('click', () => {
    void menuApi.execute(item.dataset.menuAction)
  })
}

window.addEventListener('keydown', (event) => {
  const items = menuItems().filter((item) => getComputedStyle(item).display !== 'none')
  const currentIndex = items.indexOf(document.activeElement)
  let nextIndex = currentIndex

  if (event.key === 'Escape') {
    event.preventDefault()
    void menuApi.dismiss()
    return
  }
  if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
  else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = items.length - 1
  else return

  event.preventDefault()
  items[nextIndex]?.focus()
})
