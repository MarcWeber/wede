import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeModules = join(webDir, 'node_modules')

function versionOf(pkg) {
  if (!pkg) return null
  const file = join(nodeModules, ...pkg.split('/'), 'package.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')).version
}

function install(pkg, version) {
  console.log(`[native-deps] installing ${pkg}@${version} for ${process.platform}-${process.arch}`)
  try {
    execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', `${pkg}@${version}`], {
      cwd: webDir,
      stdio: 'inherit',
    })
  } catch (err) {
    console.error(`[native-deps] could not install ${pkg}@${version}. Run "npm install" in web/ and retry.`)
    throw err
  }
}

function ensure(pkg, version) {
  if (!pkg || !version) return
  if (versionOf(pkg) === version) return
  install(pkg, version)
}

function isMusl() {
  if (process.platform !== 'linux') return false
  try {
    return !process.report?.getReport()?.header?.glibcVersionRuntime
  } catch {
    return false
  }
}

function rolldownBinding() {
  const { platform, arch } = process
  if (platform === 'darwin') return `@rolldown/binding-darwin-${arch}`
  if (platform === 'win32') return `@rolldown/binding-win32-${arch}-msvc`
  if (platform === 'linux') {
    if (arch === 'arm') return '@rolldown/binding-linux-arm-gnueabihf'
    return `@rolldown/binding-linux-${arch}-${isMusl() ? 'musl' : 'gnu'}`
  }
  if (platform === 'freebsd') return '@rolldown/binding-freebsd-x64'
  return null
}

const esbuildVersion = versionOf('esbuild')
ensure(`@esbuild/${process.platform}-${process.arch}`, esbuildVersion)

const rolldownVersion = versionOf('rolldown')
ensure(rolldownBinding(), rolldownVersion)
