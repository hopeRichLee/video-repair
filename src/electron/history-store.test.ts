import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RepairHistoryStore } from './history-store.js'
import type { RepairResult } from '../shared/types.js'

function result(index: number): RepairResult {
  return {
    success: true,
    stage: 'success',
    method: 'remux',
    outputPath: `C:\\output-${index}.mp4`,
    skippedErrors: 0,
  }
}

describe('RepairHistoryStore', () => {
  it('stores newest entries first and enforces its limit', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'repair-history-'))
    const filePath = path.join(directory, 'history.json')
    const store = new RepairHistoryStore(filePath, 3)
    for (let index = 0; index < 5; index += 1) {
      await store.add(`C:\\input-${index}.mp4`, new Date(index * 1000).toISOString(), result(index))
    }
    const entries = await store.list()
    expect(entries).toHaveLength(3)
    expect(entries.map((entry) => entry.inputPath)).toEqual(['C:\\input-4.mp4', 'C:\\input-3.mp4', 'C:\\input-2.mp4'])
    expect(JSON.parse(await readFile(filePath, 'utf8')).version).toBe(1)
  })

  it('backs up a corrupt document and recovers with an empty history', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'repair-history-'))
    const filePath = path.join(directory, 'history.json')
    await writeFile(filePath, '{not-json', 'utf8')
    const store = new RepairHistoryStore(filePath)
    await expect(store.list()).resolves.toEqual([])
    expect((await readdir(directory)).some((name) => name.startsWith('history.json.corrupt-'))).toBe(true)
  })

  it('removes entries, clears history and recognizes saved output paths', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'repair-history-'))
    const store = new RepairHistoryStore(path.join(directory, 'history.json'))
    const entry = await store.add('C:\\input.mp4', new Date().toISOString(), result(1))
    await expect(store.isKnownOutput('C:\\OUTPUT-1.mp4')).resolves.toBe(true)
    await expect(store.remove(entry.id)).resolves.toBe(true)
    await store.add('C:\\input.mp4', new Date().toISOString(), result(2))
    await store.clear()
    await expect(store.list()).resolves.toEqual([])
  })
})
