import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright-core'

const execFileAsync = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const executablePath = process.env.SMOKE_EXECUTABLE || path.join(root, 'release', 'win-unpacked', '视频修复助手.exe')
const ffmpeg = path.join(root, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe')
const outputDirectory = path.join(root, 'output', 'playwright')
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'video-repair-ui-smoke-'))
const userDataDirectory = path.join(temporaryDirectory, 'user-data')
await mkdir(outputDirectory, { recursive: true })

const healthyInput = path.join(temporaryDirectory, '一段名称很长用于验证界面截断效果的正常测试视频.mp4')
const completeForDamage = path.join(temporaryDirectory, '录制中断-complete.mp4')
const damagedInput = path.join(temporaryDirectory, '录制中断-需要参考视频.mp4')
const experimentalComplete = path.join(temporaryDirectory, 'experimental-complete.mov')
const experimentalInput = path.join(temporaryDirectory, '无参考实验恢复.mov')
const invalidInput = path.join(temporaryDirectory, '没有媒体轨道.mp4')

async function generateVideo(target, seconds) {
  await execFileAsync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
    '-t', String(seconds), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', target,
  ])
}

async function generateProfileVideo(target, seconds) {
  await execFileAsync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', String(seconds), '-shortest', '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level:v', '4.0',
    '-b:v', '17M', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-keyint_min', '30', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', target,
  ])
}

await generateVideo(healthyInput, 8)
await generateVideo(completeForDamage, 3)
const completeBytes = await readFile(completeForDamage)
const moovMarker = completeBytes.indexOf(Buffer.from('moov'))
if (moovMarker <= 4) throw new Error('无法构造缺失索引的测试视频')
await writeFile(damagedInput, completeBytes.subarray(0, moovMarker - 4))
await generateProfileVideo(experimentalComplete, 2)
const experimentalBytes = await readFile(experimentalComplete)
const experimentalMoov = experimentalBytes.indexOf(Buffer.from('moov'))
if (experimentalMoov <= 4) throw new Error('无法构造无参考恢复测试视频')
await writeFile(experimentalInput, experimentalBytes.subarray(0, experimentalMoov - 4))
await execFileAsync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '1', '-c:a', 'aac', invalidInput,
])

async function launchScenario(inputPath, label, run) {
  const errors = []
  const application = await electron.launch({
    executablePath,
    args: ['--smoke-test'],
    env: {
      ...process.env,
      SMOKE_INPUT: inputPath,
      SMOKE_REFERENCE: healthyInput,
      SMOKE_USER_DATA: userDataDirectory,
    },
  })
  try {
    const page = await application.firstWindow()
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
      console.log(`[${label}:console:${message.type()}] ${message.text()}`)
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('heading', { name: '视频修复助手' }).waitFor({ timeout: 10_000 })
    await run(page, application)
    if (errors.length) throw new Error(`${label} 页面错误：${errors.join(' | ')}`)
  } finally {
    await application.close()
  }
}

let minimumLayout
let defaultLayout
let bridgeMethods
let sourceUnchanged = false

await launchScenario(healthyInput, 'healthy', async (page, application) => {
  bridgeMethods = await page.evaluate(() => Object.keys(window.videoRepair).sort())
  await page.screenshot({ path: path.join(outputDirectory, 'app-idle.png') })
  const browserWindow = await application.browserWindow(page)
  await browserWindow.evaluate((window) => window.setSize(860, 620))
  await page.waitForTimeout(150)
  minimumLayout = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    verticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
  }))
  await page.screenshot({ path: path.join(outputDirectory, 'app-minimum.png') })
  await browserWindow.evaluate((window) => window.setSize(1120, 760))

  const before = createHash('sha256').update(await readFile(healthyInput)).digest('hex')
  await page.getByRole('button', { name: /拖入视频或点击选择/ }).click()
  await page.locator('.stage-ready').waitFor({ timeout: 20_000 })
  await page.screenshot({ path: path.join(outputDirectory, 'app-preflight.png') })
  defaultLayout = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    verticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
  }))

  await page.getByRole('button', { name: '开始修复' }).click()
  try {
    await page.getByRole('button', { name: '取消处理' }).waitFor({ timeout: 5_000 })
    await page.screenshot({ path: path.join(outputDirectory, 'app-running.png') })
  } catch {
    // Short media may complete before the running-state screenshot.
  }
  await page.getByRole('heading', { name: '质量报告' }).waitFor({ timeout: 60_000 })
  await page.screenshot({ path: path.join(outputDirectory, 'app-success.png') })
  sourceUnchanged = before === createHash('sha256').update(await readFile(healthyInput)).digest('hex')

  await page.getByRole('button', { name: /最近任务/ }).click()
  await page.getByRole('heading', { name: '最近任务' }).waitFor()
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(outputDirectory, 'app-history.png') })
})

await launchScenario(damagedInput, 'reference', async (page) => {
  await page.getByRole('button', { name: /拖入视频或点击选择/ }).click()
  await page.locator('.stage-needs-reference').waitFor({ timeout: 20_000 })
  await page.screenshot({ path: path.join(outputDirectory, 'app-needs-reference.png') })
  await page.getByRole('button', { name: /选择参考视频/ }).click()
  await page.locator('.compatibility.valid').waitFor({ timeout: 20_000 })
  await page.screenshot({ path: path.join(outputDirectory, 'app-reference-compatible.png') })
})

await launchScenario(experimentalInput, 'experimental', async (page) => {
  await page.getByRole('button', { name: /拖入视频或点击选择/ }).click()
  await page.locator('.stage-needs-reference').waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '无参考恢复' }).click()
  await page.getByRole('heading', { name: '无参考参数恢复' }).waitFor()
  await page.screenshot({ path: path.join(outputDirectory, 'app-experimental-options.png') })
  await page.getByRole('button', { name: '开始实验恢复' }).click()
  await page.getByRole('heading', { name: '质量报告' }).waitFor({ timeout: 90_000 })
  await page.locator('.quality-status.warning').waitFor()
  await page.screenshot({ path: path.join(outputDirectory, 'app-success-warning.png') })
})

await launchScenario(invalidInput, 'unavailable', async (page) => {
  await page.getByRole('button', { name: /拖入视频或点击选择/ }).click()
  await page.locator('.stage-failed').waitFor({ timeout: 20_000 })
  await page.screenshot({ path: path.join(outputDirectory, 'app-unavailable.png') })
})

console.log(JSON.stringify({ defaultLayout, minimumLayout, bridgeMethods, sourceUnchanged }, null, 2))
if (defaultLayout.horizontalOverflow || defaultLayout.verticalOverflow
  || minimumLayout.horizontalOverflow || minimumLayout.verticalOverflow
  || !sourceUnchanged
  || !bridgeMethods.includes('preflightRepair')
  || !bridgeMethods.includes('listRepairHistory')) process.exitCode = 1
