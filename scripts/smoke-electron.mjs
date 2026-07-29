import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const executablePath = process.env.SMOKE_EXECUTABLE || path.join(root, 'release', 'win-unpacked', '视频修复助手.exe')
const outputDirectory = path.join(root, 'output', 'playwright')
await mkdir(outputDirectory, { recursive: true })

const application = await electron.launch({ executablePath, args: ['--smoke-test'] })
try {
  const page = await application.firstWindow()
  page.on('console', (message) => console.log(`[console:${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`))
  await page.waitForLoadState('domcontentloaded')
  console.log(JSON.stringify({ url: page.url(), title: await page.title(), windows: application.windows().length }))
  try {
    await page.getByRole('heading', { name: '视频修复助手' }).waitFor({ timeout: 10_000 })
  } catch (error) {
    await page.screenshot({ path: path.join(outputDirectory, 'app-failure.png') })
    console.error((await page.locator('body').innerText()).slice(0, 2_000))
    throw error
  }
  await page.getByRole('button', { name: /拖入视频或点击选择/ }).waitFor()

  const bridgeMethods = await page.evaluate(() => Object.keys(window.videoRepair).sort())
  const layout = await page.evaluate(() => ({
    title: document.title,
    width: window.innerWidth,
    height: window.innerHeight,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    verticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
    startDisabled: document.querySelector('.button.primary')?.disabled,
  }))
  await page.screenshot({ path: path.join(outputDirectory, 'app-home.png') })
  const browserWindow = await application.browserWindow(page)
  await browserWindow.evaluate((window) => window.setSize(860, 620))
  await page.waitForTimeout(250)
  const minimumLayout = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    verticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
  }))
  await page.screenshot({ path: path.join(outputDirectory, 'app-minimum.png') })
  console.log(JSON.stringify({ minimumLayout }, null, 2))
  console.log(JSON.stringify({ layout, bridgeMethods }, null, 2))
  if (layout.horizontalOverflow || layout.verticalOverflow || minimumLayout.horizontalOverflow || minimumLayout.verticalOverflow || layout.startDisabled !== true) process.exitCode = 1
} finally {
  await application.close()
}
