const api = window.desktopSetup
const form = document.querySelector('#server-form')
const input = document.querySelector('#server-url')
const status = document.querySelector('#status')
const submitButton = document.querySelector('#submit-button')
const forceButton = document.querySelector('#force-button')
const cancelButton = document.querySelector('#cancel-button')
const version = document.querySelector('#version')
const recentList = document.querySelector('#recent-servers')

let busy = false
let lastFailedUrl = ''

void initialize()

async function initialize() {
  const state = await api.getState()
  input.value = state.serverUrl
  version.textContent = `v${state.version}`
  cancelButton.hidden = !state.canCancel
  if (state.startupError) showStatus(state.startupError, false)
  input.focus()
  input.select()
  void loadRecentServers()
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  void save(false)
})

forceButton.addEventListener('click', () => {
  if (input.value.trim() !== lastFailedUrl) {
    void save(false)
    return
  }
  void save(true)
})

cancelButton.addEventListener('click', () => {
  if (!busy) void api.cancel()
})

input.addEventListener('input', () => {
  forceButton.hidden = true
  lastFailedUrl = ''
  hideStatus()
})

async function save(force) {
  if (busy) return
  setBusy(true, force ? '正在保存' : '正在验证')
  hideStatus()
  const result = await api.save({ serverUrl: input.value.trim(), force })
  if (!result.ok) {
    lastFailedUrl = input.value.trim()
    showStatus(result.message, false)
    forceButton.hidden = result.code === 'invalid_url'
    setBusy(false)
    return
  }
  showStatus('配置已保存，正在重启桌面客户端。', true)
  submitButton.textContent = '正在重启'
}

function setBusy(value, label = '验证并进入') {
  busy = value
  input.disabled = value
  submitButton.disabled = value
  forceButton.disabled = value
  cancelButton.disabled = value
  submitButton.textContent = value ? label : '验证并进入'
}

function showStatus(message, success) {
  status.hidden = false
  status.textContent = message
  status.classList.toggle('success', success)
}

function hideStatus() {
  status.hidden = true
  status.textContent = ''
  status.classList.remove('success')
}

async function loadRecentServers() {
  const servers = await api.getRecentServers()
  renderRecentServers(servers)
}

function renderRecentServers(servers) {
  recentList.innerHTML = ''
  recentList.hidden = servers.length === 0
  for (const url of servers) {
    const li = document.createElement('li')

    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'recent-item'
    item.textContent = url
    item.title = url
    item.addEventListener('click', () => {
      input.value = url
      input.focus()
      forceButton.hidden = true
      lastFailedUrl = ''
      hideStatus()
    })

    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'recent-delete'
    del.textContent = '\u00d7'
    del.title = '删除此记录'
    del.addEventListener('click', async () => {
      const updated = await api.removeRecentServer(url)
      renderRecentServers(updated)
    })

    li.append(item, del)
    recentList.append(li)
  }
}
