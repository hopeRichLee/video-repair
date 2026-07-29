import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = path.resolve(import.meta.dirname, '..')
const vendorDir = path.join(root, 'vendor', 'untrunc')
const tempDir = path.join(root, 'vendor', '.untrunc-download')
const archivePath = path.join(tempDir, 'untrunc_x64.zip')
const preparedExecutable = path.join(vendorDir, 'untrunc_x64', 'untrunc.exe')
const licenseDir = path.join(root, 'licenses')
const url = 'https://github.com/anthwlock/untrunc/releases/download/latest/untrunc_x64.zip'
const expectedSha256 = '6b77fb70cb64c6e3122176399ce68e78ab4c5d12259eb61a6ec15fa0b90473a5'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))
  })
}

async function fetchFile(source, destination) {
  const response = await fetchWithRetry(source)
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

async function fetchWithRetry(source, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(source, { redirect: 'follow' })
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
  }
  throw lastError
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

if (!await exists(preparedExecutable)) {
  await mkdir(tempDir, { recursive: true })
  if (!await exists(archivePath) || await sha256(archivePath) !== expectedSha256) {
    await fetchFile(url, archivePath)
  }
  const actualSha256 = await sha256(archivePath)
  if (actualSha256 !== expectedSha256) throw new Error(`untrunc 校验失败：${actualSha256}`)

  await rm(vendorDir, { recursive: true, force: true })
  await mkdir(vendorDir, { recursive: true })
  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }',
    archivePath,
    vendorDir,
  ])
}

await mkdir(licenseDir, { recursive: true })
await cp(path.join(root, 'THIRD_PARTY_NOTICES.txt'), path.join(licenseDir, 'THIRD_PARTY_NOTICES.txt'))
const untruncLicense = path.join(licenseDir, 'untrunc-GPL-2.0.txt')
if (!await exists(untruncLicense)) {
  const licenseResponse = await fetchWithRetry('https://raw.githubusercontent.com/anthwlock/untrunc/a87f33aa36fb0e174eebad92434d2f9fc3a749da/COPYING')
  if (!licenseResponse.ok) throw new Error(`许可证下载失败：HTTP ${licenseResponse.status}`)
  await writeFile(untruncLicense, await licenseResponse.text(), 'utf8')
}
const ffmpegLicense = path.join(licenseDir, 'FFmpeg-GPL-3.0.txt')
if (!await exists(ffmpegLicense)) {
  const ffmpegLicenseResponse = await fetchWithRetry('https://raw.githubusercontent.com/FFmpeg/FFmpeg/n4.1/COPYING.GPLv3')
  if (!ffmpegLicenseResponse.ok) throw new Error(`FFmpeg 许可证下载失败：HTTP ${ffmpegLicenseResponse.status}`)
  await writeFile(ffmpegLicense, await ffmpegLicenseResponse.text(), 'utf8')
}
await rm(tempDir, { recursive: true, force: true })
console.log(`untrunc x64 已准备完成（资产 SHA-256 ${expectedSha256}）`)
