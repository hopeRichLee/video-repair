import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright-core'

const execFileAsync = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const executablePath = path.join(root, 'release', 'win-unpacked', '视频修复助手.exe')
const ffmpeg = path.join(root, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe')
const directory = await mkdtemp(path.join(tmpdir(), 'packaged-video-repair-'))
const inputPath = path.join(directory, '打包验证.mp4')

await execFileAsync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
  '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100',
  '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', inputPath,
])
const before = createHash('sha256').update(await readFile(inputPath)).digest('hex')

const application = await electron.launch({ executablePath, args: ['--smoke-test'] })
try {
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const result = await page.evaluate((source) => window.videoRepair.startRepair({ inputPath: source }), inputPath)
  const after = createHash('sha256').update(await readFile(inputPath)).digest('hex')
  console.log(JSON.stringify({ result, sourceUnchanged: before === after }, null, 2))
  if (!result.success || result.method !== 'remux' || before !== after) process.exitCode = 1
} finally {
  await application.close()
}
