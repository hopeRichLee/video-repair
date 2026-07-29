import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

function findRecursively(directory: string, fileName: string): string | null {
  if (!existsSync(directory)) return null
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return fullPath
    if (entry.isDirectory()) {
      const nested = findRecursively(fullPath, fileName)
      if (nested) return nested
    }
  }
  return null
}

export interface BinaryPaths {
  ffmpeg: string
  ffprobe: string
  untrunc: string | null
}

export function getBinaryPaths(): BinaryPaths {
  if (app.isPackaged) {
    const binaryRoot = path.join(process.resourcesPath, 'binaries')
    return {
      ffmpeg: path.join(binaryRoot, 'ffmpeg.exe'),
      ffprobe: path.join(binaryRoot, 'ffprobe.exe'),
      untrunc: findRecursively(path.join(binaryRoot, 'untrunc'), 'untrunc.exe'),
    }
  }

  return {
    ffmpeg: path.resolve('node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'),
    ffprobe: path.resolve('node_modules/@ffprobe-installer/win32-x64/ffprobe.exe'),
    untrunc: findRecursively(path.resolve('vendor/untrunc'), 'untrunc.exe'),
  }
}
