import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RepairHistoryEntry, RepairResult } from '../shared/types.js'

interface HistoryDocument {
  version: 1
  entries: RepairHistoryEntry[]
}

export class RepairHistoryStore {
  constructor(private readonly filePath: string, private readonly limit = 100) {}

  async list(): Promise<RepairHistoryEntry[]> {
    return [...(await this.read()).entries]
  }

  async add(inputPath: string, startedAt: string, result: RepairResult): Promise<RepairHistoryEntry> {
    const document = await this.read()
    const entry: RepairHistoryEntry = {
      id: randomUUID(),
      inputPath,
      outputPath: result.outputPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      success: result.success,
      stage: result.stage,
      method: result.method,
      reason: result.reason,
      warnings: result.warnings,
      verification: result.verification,
    }
    document.entries = [entry, ...document.entries].slice(0, this.limit)
    await this.write(document)
    return entry
  }

  async remove(id: string): Promise<boolean> {
    const document = await this.read()
    const entries = document.entries.filter((entry) => entry.id !== id)
    if (entries.length === document.entries.length) return false
    document.entries = entries
    await this.write(document)
    return true
  }

  async clear(): Promise<void> {
    await this.write({ version: 1, entries: [] })
  }

  async isKnownOutput(filePath: string): Promise<boolean> {
    const resolved = path.resolve(filePath).toLowerCase()
    return (await this.list()).some((entry) => entry.outputPath && path.resolve(entry.outputPath).toLowerCase() === resolved)
  }

  private async read(): Promise<HistoryDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<HistoryDocument>
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('INVALID_HISTORY')
      return { version: 1, entries: parsed.entries.slice(0, this.limit) as RepairHistoryEntry[] }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const empty: HistoryDocument = { version: 1, entries: [] }
      if (code !== 'ENOENT') {
        await this.backupCorruptFile()
        await this.write(empty)
      }
      return empty
    }
  }

  private async backupCorruptFile(): Promise<void> {
    try {
      await copyFile(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
    } catch {
      // A concurrent cleanup may already have removed the file.
    }
  }

  private async write(document: HistoryDocument): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    try {
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }
}
