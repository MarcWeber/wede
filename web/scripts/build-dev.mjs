import './ensure-native-deps.mjs'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(webDir, '..')
const outDir = join(webDir, 'dist')
const assetsDir = join(outDir, 'assets')

// Vite understands `?url`; esbuild does not. Copy the referenced file into
// dist/assets and replace the import with its URL. Chunks stay at the dist root
// so the relative `./assets/...` URL resolves from both index.js and lazy chunks.
const urlAssets = {
  name: 'url-assets',
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, async (args) => {
      const target = args.path.slice(0, -4)
      const resolved = await build.resolve(target, {
        resolveDir: args.resolveDir,
        kind: args.kind,
      })
      if (resolved.errors.length) return resolved
      return { path: resolved.path, namespace: 'url-asset' }
    })

    build.onLoad({ filter: /.*/, namespace: 'url-asset' }, async (args) => {
      const name = basename(args.path)
      await mkdir(assetsDir, { recursive: true })
      await writeFile(join(assetsDir, name), await readFile(args.path))
      return {
        contents: `export default ${JSON.stringify(`./assets/${name}`)}`,
        loader: 'js',
      }
    })
  },
}

await build({
  absWorkingDir: root,
  entryPoints: [join(webDir, 'src/main.tsx')],
  outdir: outDir,
  entryNames: 'index',
  chunkNames: '[name]-[hash]',
  bundle: true,
  splitting: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'text',
  },
  external: ['../site'],
  plugins: [urlAssets],
  logLevel: 'info',
})
