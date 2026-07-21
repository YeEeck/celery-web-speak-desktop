export type ApplicationMenuAction = 'switch-server' | 'reload' | 'about' | 'quit'

export const MENU_CHANNELS = {
  execute: 'menu:execute',
  dismiss: 'menu:dismiss',
} as const
