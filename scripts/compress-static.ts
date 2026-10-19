/** Produce gzip siblings for hashed frontend assets. */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const root = path.resolve('dist/client/assets')
for (const name of await readdir(root)) {
  if (!/\.(?:js|css)$/.test(name)) continue
  const source = await readFile(path.join(root, name))
  await writeFile(path.join(root, `${name}.gz`), gzipSync(source, { level: 9 }))
}
