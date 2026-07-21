import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(path.join(root, 'assets', 'icon-source.svg'))
const output = path.join(root, 'build', 'icons')
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]

await mkdir(output, { recursive: true })
for (const size of sizes) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(output, `${size}x${size}.png`))
}
await sharp(source).resize(512, 512).png().toFile(path.join(output, 'icon.png'))

const icoInputs = [16, 32, 48, 64, 128, 256].map((size) => path.join(output, `${size}x${size}.png`))
await writeFile(path.join(output, 'icon.ico'), await pngToIco(icoInputs))
