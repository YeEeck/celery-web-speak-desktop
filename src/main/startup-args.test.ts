import { describe, expect, it } from 'vitest'
import { AUTOSTART_FLAG, isAutostartLaunch, relaunchArguments } from './startup-args.js'

describe('isAutostartLaunch', () => {
  it('recognizes the exact flag', () => {
    expect(isAutostartLaunch(['--autostart'])).toBe(true)
  })

  it('recognizes the flag among the arguments Electron and the application pass', () => {
    expect(isAutostartLaunch(['C:\\Program Files\\Celery Web Speak\\Celery Web Speak.exe', '--autostart']))
      .toBe(true)
    expect(isAutostartLaunch(['electron.exe', '.', '--autostart'])).toBe(true)
    expect(isAutostartLaunch(['--disable-gpu', '--autostart', '--lang=zh-CN'])).toBe(true)
  })

  it('does not match empty argument lists', () => {
    expect(isAutostartLaunch([])).toBe(false)
    expect(isAutostartLaunch(['electron.exe', '.'])).toBe(false)
  })

  it('does not match lookalike arguments', () => {
    for (const argv of [
      ['--autostart=1'],
      ['--autostart=true'],
      ['--no-autostart'],
      ['--autostart-disabled'],
      ['--AUTOSTART'],
      ['--autostart '],
      [' --autostart'],
      [''],
      ['C:\\Users\\me\\--autostart'],
      ['C:\\Users\\me\\app --autostart'],
    ]) {
      expect(isAutostartLaunch(argv), JSON.stringify(argv)).toBe(false)
    }
  })

  it('exposes the argument written by the startup entry', () => {
    expect(AUTOSTART_FLAG).toBe('--autostart')
  })
})

describe('relaunchArguments', () => {
  it('drops the startup entry flag so a user-initiated relaunch presents normally', () => {
    expect(relaunchArguments(['C:\\App\\Celery Web Speak.exe', '--autostart'])).toEqual([])
    expect(relaunchArguments(['electron.exe', '.', '--autostart', '--foo'])).toEqual(['.', '--foo'])
  })

  it('keeps the arguments a normal launch passed', () => {
    expect(relaunchArguments(['electron.exe', '.'])).toEqual(['.'])
    expect(relaunchArguments(['C:\\App\\Celery Web Speak.exe'])).toEqual([])
  })

  it('does not touch lookalike arguments', () => {
    expect(relaunchArguments(['app.exe', '--autostart=1', '--no-autostart']))
      .toEqual(['--autostart=1', '--no-autostart'])
  })
})
