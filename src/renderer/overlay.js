const participants = document.querySelector('#participants')

const MIC_OFF_ICON = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"></line>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"></path>
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
    <line x1="12" y1="19" x2="12" y2="23"></line>
    <line x1="8" y1="23" x2="16" y2="23"></line>
  </svg>`

const HEADPHONES_OFF_ICON = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"></line>
    <path d="M6.5 15v-4a5.5 5.5 0 0 1 10.6-2"></path>
    <path d="M21 15v-3a9 9 0 0 0-1.1-4.4"></path>
    <path d="M3 12a9 9 0 0 1 1.1-4.4"></path>
    <path d="M4 14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2z"></path>
    <path d="M20 14a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2z"></path>
  </svg>`

void window.overlayHost.getState().then(render)

window.overlayHost.onState(render)

function render(state) {
  renderParticipants(state.participants ?? [])
}

function renderParticipants(list) {
  const fragment = document.createDocumentFragment()
  for (const participant of list) {
    const row = document.createElement('li')
    row.className = 'participant' + (participant.speaking ? ' speaking' : '')

    const avatar = document.createElement('span')
    avatar.className = 'participant-avatar'
    if (participant.avatarUrl) {
      const image = document.createElement('img')
      image.alt = ''
      image.src = participant.avatarUrl
      image.addEventListener('error', () => {
        image.remove()
        avatar.textContent = initialOf(participant.name)
      })
      avatar.append(image)
    } else {
      avatar.textContent = initialOf(participant.name)
    }

    const name = document.createElement('span')
    name.className = 'participant-name'
    name.textContent = participant.name
    if (participant.isLocal) {
      const local = document.createElement('span')
      local.className = 'participant-local'
      local.textContent = '（你）'
      name.append(local)
    }

    row.append(avatar, name)
    if (participant.deafened) {
      const icon = document.createElement('span')
      icon.className = 'participant-icon deafened'
      icon.innerHTML = HEADPHONES_OFF_ICON
      row.append(icon)
    } else if (participant.microphoneMuted) {
      const icon = document.createElement('span')
      icon.className = 'participant-icon'
      icon.innerHTML = MIC_OFF_ICON
      row.append(icon)
    }
    fragment.append(row)
  }
  participants.replaceChildren(fragment)
}

function initialOf(name) {
  return Array.from(name.trim())[0]?.toUpperCase() || '?'
}
