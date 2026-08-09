import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopApi, RepairProgress, StartRepairRequest } from '../shared/types.js'

const api: DesktopApi = {
  selectInput: () => ipcRenderer.invoke('video-repair:select-input'),
  selectReference: () => ipcRenderer.invoke('video-repair:select-reference'),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  preflightRepair: (request) => ipcRenderer.invoke('video-repair:preflight', request),
  startRepair: (request: StartRepairRequest) => ipcRenderer.invoke('video-repair:start', request),
  cancelRepair: () => ipcRenderer.invoke('video-repair:cancel'),
  openOutput: (filePath) => ipcRenderer.invoke('video-repair:open-output', filePath),
  openOutputFolder: (filePath) => ipcRenderer.invoke('video-repair:open-output-folder', filePath),
  exportLog: (logPath) => ipcRenderer.invoke('video-repair:export-log', logPath),
  copyText: (text) => ipcRenderer.invoke('video-repair:copy-text', text),
  listRepairHistory: () => ipcRenderer.invoke('video-repair:history-list'),
  removeRepairHistoryEntry: (id) => ipcRenderer.invoke('video-repair:history-remove', id),
  clearRepairHistory: () => ipcRenderer.invoke('video-repair:history-clear'),
  onProgress: (callback) => {
    ipcRenderer.on('video-repair:progress', (_event, progress: RepairProgress) => callback(progress))
  },
  removeProgressListeners: () => ipcRenderer.removeAllListeners('video-repair:progress'),
}

contextBridge.exposeInMainWorld('videoRepair', api)
