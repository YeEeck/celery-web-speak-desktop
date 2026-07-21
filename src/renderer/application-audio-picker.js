const picker = window.applicationAudioPicker
const sourcesElement = document.querySelector('#sources')
const statusElement = document.querySelector('#status')
const shareButton = document.querySelector('#share')
const refreshButton = document.querySelector('#refresh')
let selectedToken = null
let loading = false

document.querySelector('#close-picker').addEventListener('click', cancel)
document.querySelector('#cancel').addEventListener('click', cancel)
refreshButton.addEventListener('click', loadSources)
shareButton.addEventListener('click', chooseSelected)

void loadSources()

async function loadSources() {
  if (loading) return
  loading = true
  selectedToken = null
  shareButton.disabled = true
  refreshButton.disabled = true
  sourcesElement.replaceChildren()
  statusElement.textContent = '正在查找窗口...'
  try {
    const sources = await picker.getSources()
    if (sources.length === 0) {
      statusElement.textContent = '没有可共享的应用窗口'
      return
    }
    statusElement.textContent = ''
    sourcesElement.replaceChildren(...sources.map(createSourceButton))
  } catch {
    statusElement.textContent = '无法获取应用窗口'
  } finally {
    loading = false
    refreshButton.disabled = false
  }
}

function createSourceButton(source) {
  const button = document.createElement('button')
  button.className = 'source'
  button.type = 'button'
  button.role = 'option'
  button.ariaSelected = 'false'
  button.title = source.title
  button.dataset.token = source.token

  const thumbnail = document.createElement('span')
  thumbnail.className = 'thumbnail'
  if (source.thumbnailDataUrl) {
    const image = document.createElement('img')
    image.src = source.thumbnailDataUrl
    image.alt = ''
    thumbnail.append(image)
  }

  const label = document.createElement('span')
  label.className = 'source-label'
  if (source.appIconDataUrl) {
    const icon = document.createElement('img')
    icon.className = 'app-icon'
    icon.src = source.appIconDataUrl
    icon.alt = ''
    label.append(icon)
  } else {
    const placeholder = document.createElement('span')
    placeholder.className = 'app-icon-placeholder'
    label.append(placeholder)
  }
  const title = document.createElement('span')
  title.className = 'source-title'
  title.textContent = source.title
  label.append(title)
  button.append(thumbnail, label)
  button.addEventListener('click', () => select(button, source.token))
  button.addEventListener('dblclick', () => {
    select(button, source.token)
    void chooseSelected()
  })
  return button
}

function select(button, token) {
  selectedToken = token
  for (const source of sourcesElement.querySelectorAll('.source')) {
    source.ariaSelected = String(source === button)
  }
  shareButton.disabled = false
}

async function chooseSelected() {
  if (!selectedToken) return
  shareButton.disabled = true
  try {
    await picker.choose(selectedToken)
  } catch {
    statusElement.textContent = '所选窗口已不可用，请刷新后重试'
    shareButton.disabled = false
  }
}

function cancel() {
  void picker.cancel()
}

