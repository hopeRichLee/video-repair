import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { RepairEngine } from './repair-engine.js'

const execFileAsync = promisify(execFile)
const integration = process.env.RUN_MEDIA_INTEGRATION === '1' ? describe : describe.skip
const root = path.resolve(import.meta.dirname, '../..')
const ffmpeg = path.join(root, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe')
const ffprobe = path.join(root, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe')
const untrunc = path.join(root, 'vendor/untrunc/untrunc_x64/untrunc.exe')

async function generateVideo(target: string, seconds: number): Promise<void> {
  await execFileAsync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100',
    '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', target,
  ])
}

async function generateIphone6ProfileVideo(target: string, seconds: number): Promise<void> {
  await execFileAsync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', String(seconds), '-shortest', '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level:v', '4.0',
    '-b:v', '17M', '-pix_fmt', 'yuv420p', '-r', '30',
    '-g', '60', '-keyint_min', '30', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', target,
  ])
}

async function generateHevcProfileVideo(target: string, seconds: number): Promise<void> {
  await execFileAsync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', String(seconds), '-shortest', '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-level:v', '4.0',
    '-x265-params', 'log-level=error', '-b:v', '12M', '-pix_fmt', 'yuv420p', '-r', '30',
    '-g', '60', '-keyint_min', '30', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', target,
  ])
}

function digest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

integration('RepairEngine with real media tools', () => {
  it('remuxes a readable MP4 without changing its source', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '视频修复-'))
    const input = path.join(directory, '正常 样本.mp4')
    await generateVideo(input, 1)
    const before = digest(await readFile(input))
    const engine = new RepairEngine({ ffmpeg, ffprobe, untrunc }, path.join(directory, 'logs'), () => undefined)

    const preflight = await engine.preflight({ inputPath: input })
    expect(preflight.canStart).toBe(true)
    expect(preflight.recommendedStrategy).toBe('remux')
    expect(preflight.diskSpace.sufficient).toBe(true)

    const result = await engine.start({ inputPath: input })

    expect(result.success).toBe(true)
    expect(result.method).toBe('remux')
    expect(result.outputPath).toContain('_已修复.mp4')
    expect(digest(await readFile(input))).toBe(before)
  }, 30_000)

  it('requests a reference then rebuilds a missing moov atom', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '视频修复-'))
    const reference = path.join(directory, '参考.mp4')
    const complete = path.join(directory, '录制中断-complete.mp4')
    const damaged = path.join(directory, '录制中断.mp4')
    await generateVideo(reference, 1)
    await generateVideo(complete, 2)
    const bytes = await readFile(complete)
    const moovMarker = bytes.indexOf(Buffer.from('moov'))
    expect(moovMarker).toBeGreaterThan(4)
    await writeFile(damaged, bytes.subarray(0, moovMarker - 4))
    const before = digest(await readFile(damaged))
    const engine = new RepairEngine({ ffmpeg, ffprobe, untrunc }, path.join(directory, 'logs'), () => undefined)

    const promptResult = await engine.start({ inputPath: damaged })
    expect(promptResult.stage).toBe('needs-reference')

    const result = await engine.start({ inputPath: damaged, referencePath: reference })
    expect(result.success).toBe(true)
    expect(result.method).toBe('index-rebuild')
    expect(digest(await readFile(damaged))).toBe(before)
  }, 60_000)

  it('recovers H.264 with a matching generic profile', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '视频修复-'))
    const complete = path.join(directory, 'iPhone6-complete.mov')
    const damaged = path.join(directory, 'iPhone6-无参考.mov')
    await generateIphone6ProfileVideo(complete, 2)
    const bytes = await readFile(complete)
    const moovMarker = bytes.indexOf(Buffer.from('moov'))
    expect(moovMarker).toBeGreaterThan(4)
    await writeFile(damaged, bytes.subarray(0, moovMarker - 4))
    const before = digest(await readFile(damaged))
    const engine = new RepairEngine({ ffmpeg, ffprobe, untrunc }, path.join(directory, 'logs'), () => undefined)

    const result = await engine.start({ inputPath: damaged, experimentalRecovery: true })

    expect(result.success).toBe(true)
    expect(result.method).toBe('experimental-index')
    expect(result.warnings?.[0]).toContain('无参考实验恢复')
    expect(digest(await readFile(damaged))).toBe(before)
  }, 90_000)

  it('recovers an HEVC recording with an exact generic profile hint', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '视频修复-hevc-'))
    const complete = path.join(directory, 'hevc-complete.mov')
    const damaged = path.join(directory, 'hevc-无参考.mov')
    await generateHevcProfileVideo(complete, 2)
    const bytes = await readFile(complete)
    const moovMarker = bytes.indexOf(Buffer.from('moov'))
    expect(moovMarker).toBeGreaterThan(4)
    await writeFile(damaged, bytes.subarray(0, moovMarker - 4))
    const before = digest(await readFile(damaged))
    const engine = new RepairEngine({ ffmpeg, ffprobe, untrunc }, path.join(directory, 'logs'), () => undefined)

    const result = await engine.start({
      inputPath: damaged,
      experimentalRecovery: true,
      recoveryHints: { codec: 'hevc', width: 1920, height: 1080, frameRate: 30 },
    })

    expect(result.success).toBe(true)
    expect(result.method).toBe('experimental-index')
    expect(result.verification?.decodedFrames).toBeGreaterThan(0)
    expect(digest(await readFile(damaged))).toBe(before)
  }, 120_000)

  it('cancels an experimental profile attempt without changing its source', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '视频修复-cancel-'))
    const complete = path.join(directory, 'cancel-complete.mp4')
    const damaged = path.join(directory, 'cancel-damaged.mp4')
    await generateIphone6ProfileVideo(complete, 2)
    const bytes = await readFile(complete)
    const moovMarker = bytes.indexOf(Buffer.from('moov'))
    await writeFile(damaged, bytes.subarray(0, moovMarker - 4))
    const before = digest(await readFile(damaged))
    let engine: RepairEngine
    let cancelled = false
    engine = new RepairEngine({ ffmpeg, ffprobe, untrunc }, path.join(directory, 'logs'), (progress) => {
      if (!cancelled && progress.recoveryAttempt) {
        cancelled = true
        void engine.cancel()
      }
    })

    const result = await engine.start({
      inputPath: damaged,
      experimentalRecovery: true,
      recoveryHints: { codec: 'h264', width: 3840, height: 2160, frameRate: 30 },
    })

    expect(result.stage).toBe('cancelled')
    expect(digest(await readFile(damaged))).toBe(before)
  }, 60_000)

  it('skips an unknown byte sequence and recovers video after the damaged area', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '视频修复-'))
    const reference = path.join(directory, '参考-跳过坏数据.mp4')
    const complete = path.join(directory, '含坏数据-complete.mp4')
    const damaged = path.join(directory, '含坏数据.mp4')
    await generateVideo(reference, 1)
    await generateVideo(complete, 4)
    const bytes = await readFile(complete)
    const moovMarker = bytes.indexOf(Buffer.from('moov'))
    const mdatMarker = bytes.indexOf(Buffer.from('mdat'))
    expect(moovMarker).toBeGreaterThan(mdatMarker)
    const withoutMoov = bytes.subarray(0, moovMarker - 4)
    const insertionPoint = Math.floor((mdatMarker + 4 + withoutMoov.length) / 2)
    const damagedBytes = Buffer.concat([
      withoutMoov.subarray(0, insertionPoint),
      Buffer.from('VIDEO_REPAIR_UNKNOWN_SEQUENCE_7d14f9'),
      withoutMoov.subarray(insertionPoint),
    ])
    await writeFile(damaged, damagedBytes)
    const progressMessages: string[] = []
    const engine = new RepairEngine(
      { ffmpeg, ffprobe, untrunc },
      path.join(directory, 'logs'),
      (progress) => progressMessages.push(progress.message),
    )

    const result = await engine.start({ inputPath: damaged, referencePath: reference })

    expect(result.success).toBe(true)
    expect(result.method).toBe('index-rebuild')
    expect(progressMessages).toContain('正在跳过损坏数据并搜索后续画面…')
  }, 60_000)
})
