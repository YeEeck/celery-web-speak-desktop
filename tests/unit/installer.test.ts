import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const installerPath = path.join(root, 'build', 'installer.iss')

describe('Inno Setup installer', () => {
  it('keeps local message files in the repository', async () => {
    const script = await readFile(installerPath, 'utf8')
    const messageFiles = [...script.matchAll(/MessagesFile:\s*"([^"]+)"/g)]
      .map((match) => match[1])
      .filter((file): file is string => file !== undefined && !file.startsWith('compiler:'))

    expect(messageFiles).toContain('languages\\ChineseSimplified.isl')

    for (const file of messageFiles) {
      const localPath = file.replaceAll('\\', path.sep)
      await expect(access(path.resolve(path.dirname(installerPath), localPath))).resolves.toBeUndefined()
    }
  })
})
