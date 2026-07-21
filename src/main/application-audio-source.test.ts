import { describe, expect, it } from 'vitest'
import { isSelectableWindowSource, parseWindowSourceId } from './application-audio-source.js'

describe('application audio window sources', () => {
  it.each([
    ['window:42:0', '42'],
    ['window:18446744073709551615:7', '18446744073709551615'],
  ])('parses HWND without converting it to a JavaScript number', (sourceId, expected) => {
    expect(parseWindowSourceId(sourceId)).toBe(expected)
  })

  it.each([
    'screen:42:0',
    'window:0:0',
    'window:-1:0',
    'window:01:0',
    'window:1:',
    'window:1.5:0',
    'window: 1:0',
  ])('rejects malformed source ID %s', (sourceId) => {
    expect(parseWindowSourceId(sourceId)).toBeNull()
  })

  it('filters local windows by media source ID rather than title', () => {
    const localIds = new Set(['window:10:0'])
    expect(isSelectableWindowSource({
      id: 'window:10:0',
      title: 'Unrelated title',
      thumbnailEmpty: false,
    }, localIds)).toBe(false)
    expect(isSelectableWindowSource({
      id: 'window:11:0',
      title: 'Celery Web Speak',
      thumbnailEmpty: false,
    }, localIds)).toBe(true)
  })

  it('rejects candidates that cannot be identified', () => {
    expect(isSelectableWindowSource({
      id: 'window:11:0',
      title: '   ',
      thumbnailEmpty: true,
    }, new Set())).toBe(false)
  })
})

