import { describe, expect, it } from 'vitest'
import { compareVersions, normalizeTag, parseGitHubRepo } from './update-checker.js'

describe('parseGitHubRepo', () => {
  it('parses https URL with .git suffix', () => {
    expect(parseGitHubRepo('https://github.com/YeEeck/celery-web-speak-desktop.git')).toEqual({
      owner: 'YeEeck',
      repo: 'celery-web-speak-desktop',
    })
  })

  it('parses https URL without .git suffix', () => {
    expect(parseGitHubRepo('https://github.com/YeEeck/celery-web-speak-desktop')).toEqual({
      owner: 'YeEeck',
      repo: 'celery-web-speak-desktop',
    })
  })

  it('parses SSH URL', () => {
    expect(parseGitHubRepo('git@github.com:YeEeck/celery-web-speak-desktop.git')).toEqual({
      owner: 'YeEeck',
      repo: 'celery-web-speak-desktop',
    })
  })

  it('returns empty for invalid URL', () => {
    expect(parseGitHubRepo('')).toEqual({ owner: '', repo: '' })
    expect(parseGitHubRepo('https://gitlab.com/foo/bar')).toEqual({ owner: '', repo: '' })
  })
})

describe('normalizeTag', () => {
  it('strips v prefix', () => {
    expect(normalizeTag('v0.2.10')).toBe('0.2.10')
  })

  it('returns as-is without v prefix', () => {
    expect(normalizeTag('0.2.10')).toBe('0.2.10')
  })
})

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('0.2.10', '0.2.10')).toBe(0)
  })

  it('returns positive when a > b', () => {
    expect(compareVersions('0.3.0', '0.2.10')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.11', '0.2.10')).toBeGreaterThan(0)
  })

  it('returns negative when a < b', () => {
    expect(compareVersions('0.2.9', '0.2.10')).toBeLessThan(0)
    expect(compareVersions('0.1.0', '1.0.0')).toBeLessThan(0)
  })
})
