import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBinaryPaths } from './binary-paths.js'
import { RepairHistoryStore } from './history-store.js'
import { validatePreflightRepairRequest, validateStartRepairRequest } from './ipc-validation.js'
import { RepairEngine } from './repair-engine.js'
import type { PreflightRepairRequest, StartRepairRequest } from '../shared/types.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let engine: RepairEngine | null = null
let historyStore: RepairHistoryStore | null = null

async function isKnownOutput(filePath: string): Promise<boolean> {
  return Boolean(engine?.isKnownOutput(filePath)) || Boolean(await historyStore?.isKnownOutput(filePath))
}

function createWindow(): void {
  const windowIcon = path.join(app.getAppPath(), 'build', 'icon.ico')

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    show: false,
    backgroundColor: '#f3f5f6',
    title: '视频修复助手',
    icon: windowIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const developmentUrl = process.env.VITE_DEV_SERVER_URL
  if (developmentUrl) void mainWindow.loadURL(developmentUrl)
  else void mainWindow.loadFile(path.resolve(currentDirectory, '../../dist/index.html'))

  engine = new RepairEngine(
    getBinaryPaths(),
    path.join(app.getPath('userData'), 'logs'),
    (progress) => mainWindow?.webContents.send('video-repair:progress', progress),
  )
}

function registerIpc(): void {
  const filters = [{ name: '支持的视频', extensions: ['mp4', 'mov', 'm4v', '3gp'] }]

  ipcMain.handle('video-repair:select-input', async () => {
    if (isSmokeTest && process.env.SMOKE_INPUT) return path.resolve(process.env.SMOKE_INPUT)
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择损坏的视频', properties: ['openFile'], filters })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('video-repair:select-reference', async () => {
    if (isSmokeTest && process.env.SMOKE_REFERENCE) return path.resolve(process.env.SMOKE_REFERENCE)
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择同一设备拍摄的正常视频', properties: ['openFile'], filters })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('video-repair:start', async (_event, request: StartRepairRequest) => {
    validateStartRepairRequest(request)
    const startedAt = new Date().toISOString()
    const result = await engine!.start(request)
    if (result.stage !== 'needs-reference') {
      try { await historyStore!.add(request.inputPath, startedAt, result) }
      catch (error) { console.error('无法保存修复历史', error) }
    }
    return result
  })
  ipcMain.handle('video-repair:preflight', async (_event, request: PreflightRepairRequest) => {
    validatePreflightRepairRequest(request)
    return await engine!.preflight(request)
  })
  ipcMain.handle('video-repair:cancel', () => engine?.cancel() ?? false)
  ipcMain.handle('video-repair:open-output', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !(await isKnownOutput(filePath))) throw new Error('输出路径无效')
    const error = await shell.openPath(filePath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('video-repair:open-output-folder', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !(await isKnownOutput(filePath))) throw new Error('输出路径无效')
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('video-repair:export-log', async () => {
    const source = engine?.getLastLogPath()
    if (!source || !path.isAbsolute(source)) return null
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '导出修复日志',
      defaultPath: `视频修复日志-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }],
    })
    if (result.canceled || !result.filePath) return null
    await copyFile(source, result.filePath)
    return result.filePath
  })
  ipcMain.handle('video-repair:copy-text', (_event, text: string) => {
    if (typeof text === 'string') clipboard.writeText(text.slice(0, 20_000))
  })
  ipcMain.handle('video-repair:history-list', () => historyStore!.list())
  ipcMain.handle('video-repair:history-remove', (_event, id: string) => {
    if (typeof id !== 'string' || id.length > 100) throw new Error('历史记录标识无效')
    return historyStore!.remove(id)
  })
  ipcMain.handle('video-repair:history-clear', () => historyStore!.clear())
}

const isSmokeTest = process.argv.includes('--smoke-test')
if (isSmokeTest && process.env.SMOKE_USER_DATA) app.setPath('userData', path.resolve(process.env.SMOKE_USER_DATA))
const gotLock = isSmokeTest || app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })
  app.whenReady().then(() => {
    historyStore = new RepairHistoryStore(path.join(app.getPath('userData'), 'repair-history.json'))
    registerIpc()
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => { void engine?.cancel() })
}
