import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { access, link, mkdir, rename, rm, stat, statfs } from 'node:fs/promises'
import path from 'node:path'
import type { BinaryPaths } from './binary-paths.js'
import {
  areReferencesCompatible,
  calculateDecodeQuality,
  classifyDiagnosis,
  countMediaErrors,
  parseProgressBlock,
  parseUntruncSummary,
  stripUntruncProgressNoise,
  type ProbeJson,
  uniqueOutputPath,
  validateMediaPath,
} from './media-utils.js'
import { ProcessRunner } from './process-runner.js'
import type { Diagnosis, RepairProgress, RepairResult, RepairStage, StartRepairRequest } from '../shared/types.js'

interface ProbeResult {
  data?: ProbeJson
  stderr: string
  code: number
}

interface VerificationResult {
  valid: boolean
  probe?: ProbeJson
  reason?: string
  decodedFrames?: number
  expectedFrames?: number | null
  decodeRatio?: number | null
}

interface ExperimentalProfile {
  id: string
  label: string
  width: number
  height: number
  frameRate: number
  level: string
  videoBitrate: string
}

const IPHONE_6_PROFILES: ExperimentalProfile[] = [
  { id: 'iphone6-1080p30', label: 'iPhone 6 · 1080p 30fps', width: 1920, height: 1080, frameRate: 30, level: '4.0', videoBitrate: '17M' },
  { id: 'iphone6-1080p60', label: 'iPhone 6 · 1080p 60fps', width: 1920, height: 1080, frameRate: 60, level: '4.2', videoBitrate: '26M' },
  { id: 'iphone6-720p30', label: 'iPhone 6 · 720p 30fps', width: 1280, height: 720, frameRate: 30, level: '3.1', videoBitrate: '10M' },
]

export class RepairEngine {
  private readonly runner = new ProcessRunner()
  private active = false
  private startedAt = 0
  private logPath = ''
  private errorCount = 0
  private temporaryPaths = new Set<string>()
  private currentStage: RepairStage = 'idle'
  private currentMessage = ''
  private lastOutputPath = ''
  private lastIndexRecoveryDetail = ''
  private recoveryWarnings: string[] = []

  constructor(
    private readonly binaries: BinaryPaths,
    private readonly logDirectory: string,
    private readonly sendProgress: (progress: RepairProgress) => void,
  ) {}

  async start(request: StartRepairRequest): Promise<RepairResult> {
    if (this.active) throw new Error('已有修复任务正在运行')
    this.active = true
    this.runner.reset()
    this.startedAt = Date.now()
    this.errorCount = 0
    this.lastIndexRecoveryDetail = ''
    this.recoveryWarnings = []
    this.temporaryPaths.clear()
    await mkdir(this.logDirectory, { recursive: true })
    this.logPath = path.join(this.logDirectory, `repair-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)

    let diagnosis: Diagnosis | undefined
    try {
      const inputPath = await validateMediaPath(request.inputPath)
      this.currentInputForOutput = inputPath
      await this.ensureDiskSpace(inputPath)
      this.writeLog(`开始诊断：${inputPath}`)
      this.emit('diagnosing', '正在分析视频结构…', null)

      const inputProbe = await this.probe(inputPath)
      diagnosis = classifyDiagnosis(inputProbe.stderr, inputProbe.data)
      this.emit('diagnosing', diagnosis.summary, 5, { diagnosis })

      if (diagnosis.needsReference) {
        if (request.experimentalRecovery && request.referencePath) {
          throw new Error('无参考实验恢复不能同时指定参考视频')
        }
        if (request.experimentalRecovery) {
          if (!this.binaries.untrunc) throw new Error('索引恢复引擎未安装，请重新安装应用')
          const repaired = await this.recoverWithoutReference(inputPath, diagnosis)
          if (repaired) return repaired
          throw new Error(this.lastIndexRecoveryDetail || '无参考实验恢复未找到可可靠解码的结果')
        }
        if (!request.referencePath) {
          this.emit('needs-reference', '需要选择同一设备拍摄的正常参考视频', null, { diagnosis })
          return this.result(false, 'needs-reference', diagnosis, '索引缺失，请选择参考视频后继续')
        }
        const referencePath = await validateMediaPath(request.referencePath)
        if (path.resolve(referencePath).toLowerCase() === path.resolve(inputPath).toLowerCase()) {
          throw new Error('参考视频不能与损坏视频相同')
        }
        const referenceProbe = await this.probe(referencePath)
        const compatibility = areReferencesCompatible(inputProbe.data, referenceProbe.data ?? {})
        if (!compatibility.compatible) throw new Error(compatibility.reason)
        if (!this.binaries.untrunc) throw new Error('索引恢复引擎未安装，请重新安装应用')

        this.writeLog(`参考视频：${referencePath}`)
        const rebuilt = await this.rebuildIndex(inputPath, referencePath, referenceProbe.data)
        const repaired = await this.finishCandidate(rebuilt, diagnosis, 'index-rebuild')
        if (repaired) return repaired
        throw new Error(this.lastIndexRecoveryDetail || '已找到视频轨道，但恢复结果没有解出有效画面；请尝试更匹配的参考视频')
      }

      if (diagnosis.category === 'no-media') {
        throw new Error('文件中没有可识别的视频轨道，无法进行通用修复')
      }

      const remuxCandidate = this.createTemporaryOutput(inputPath, 'remux')
      this.emit('remuxing', '正在无损重建视频容器…', 6)
      const remuxed = await this.runFfmpeg('remuxing', diagnosis.durationSeconds, [
        '-y', '-fflags', '+genpts+discardcorrupt+igndts', '-err_detect', 'ignore_err',
        '-i', inputPath,
        '-map', '0:v:0?', '-map', '0:a?', '-map_metadata', '0',
        '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats', remuxCandidate,
      ])
      if (remuxed.code === 0) {
        const repaired = await this.finishCandidate(remuxCandidate, diagnosis, 'remux')
        if (repaired) return repaired
      }
      await this.safeRemove(remuxCandidate)

      const transcodeCandidate = this.createTemporaryOutput(inputPath, 'transcode')
      this.emit('transcoding', '无损修复未通过验证，正在深度抢救画面…', 6)
      const transcoded = await this.runFfmpeg('transcoding', diagnosis.durationSeconds, [
        '-y', '-fflags', '+genpts+discardcorrupt+igndts', '-err_detect', 'ignore_err',
        '-i', inputPath,
        '-map', '0:v:0?', '-map', '0:a?', '-map_metadata', '0',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-vsync', 'vfr',
        '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats', transcodeCandidate,
      ])
      if (transcoded.code === 0) {
        const repaired = await this.finishCandidate(transcodeCandidate, diagnosis, 'transcode')
        if (repaired) return repaired
      }
      throw new Error('容错转码仍未得到可播放的视频，媒体数据可能严重损坏或缺失')
    } catch (error) {
      const cancelled = this.runner.isCancelled() || (error instanceof Error && error.message === 'TASK_CANCELLED')
      const reason = cancelled ? '修复已取消' : error instanceof Error ? error.message : '修复失败'
      this.writeLog(reason)
      this.emit(cancelled ? 'cancelled' : 'failed', reason, null)
      return this.result(false, cancelled ? 'cancelled' : 'failed', diagnosis, reason)
    } finally {
      await this.cleanup()
      this.active = false
    }
  }

  async cancel(): Promise<boolean> {
    if (!this.active) return false
    await this.runner.cancel()
    return true
  }

  getLastLogPath(): string | undefined {
    return this.logPath || undefined
  }

  isKnownOutput(filePath: string): boolean {
    return Boolean(this.lastOutputPath) && path.resolve(filePath).toLowerCase() === path.resolve(this.lastOutputPath).toLowerCase()
  }

  private async probe(filePath: string): Promise<ProbeResult> {
    const result = await this.runner.run(this.binaries.ffprobe, [
      '-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', filePath,
    ], { onStderr: (chunk) => this.captureErrors(chunk) })
    let data: ProbeJson | undefined
    try {
      data = JSON.parse(result.stdout) as ProbeJson
    } catch {
      data = undefined
    }
    return { data, stderr: result.stderr, code: result.code }
  }

  private async runFfmpeg(stage: RepairStage, duration: number, args: string[]) {
    let progressBuffer = ''
    return await this.runner.run(this.binaries.ffmpeg, args, {
      onStdout: (chunk) => {
        progressBuffer += chunk
        const blocks = progressBuffer.split(/(?<=progress=(?:continue|end))\r?\n/)
        progressBuffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const progress = parseProgressBlock(block, duration)
          this.emit(stage, stage === 'transcoding' ? '正在深度抢救画面…' : '正在无损重建视频容器…', progress.percent, progress)
        }
      },
      onStderr: (chunk) => this.captureErrors(chunk),
    })
  }

  private async recoverWithoutReference(inputPath: string, diagnosis: Diagnosis): Promise<RepairResult | null> {
    const profileDirectory = path.join(path.dirname(inputPath), `.video-repair-profiles-${randomUUID()}`)
    await mkdir(profileDirectory)
    this.temporaryPaths.add(profileDirectory)
    const failures: string[] = []

    this.writeLog('启动无参考实验恢复：依次尝试 iPhone 6 常见 H.264 录像参数')
    for (const [index, profile] of IPHONE_6_PROFILES.entries()) {
      const referencePath = path.join(profileDirectory, `${profile.id}.mov`)
      const message = `正在尝试 ${profile.label}（${index + 1}/${IPHONE_6_PROFILES.length}）…`
      this.emit('rebuilding-index', message, null)
      this.writeLog(message)

      const generated = await this.runner.run(this.binaries.ffmpeg, [
        '-y',
        '-f', 'lavfi', '-i', `testsrc2=size=${profile.width}x${profile.height}:rate=${profile.frameRate}`,
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-t', '1.5', '-shortest',
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level:v', profile.level,
        '-b:v', profile.videoBitrate, '-pix_fmt', 'yuv420p', '-r', String(profile.frameRate),
        '-g', String(profile.frameRate * 2), '-keyint_min', String(profile.frameRate), '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart', referencePath,
      ], { onStderr: (chunk) => this.writeLog(chunk.trimEnd()) })
      if (generated.code !== 0) {
        failures.push(`${profile.label}：内部参数样本生成失败`)
        continue
      }

      const referenceProbe = await this.probe(referencePath)
      if (!referenceProbe.data) {
        failures.push(`${profile.label}：内部参数样本无法读取`)
        continue
      }

      const warningsBeforeAttempt = [...this.recoveryWarnings]
      try {
        const candidate = await this.rebuildIndex(inputPath, referencePath, referenceProbe.data)
        this.recoveryWarnings = [
          '这是无参考实验恢复结果，请完整检查画面、声音和时长',
          ...warningsBeforeAttempt,
        ]
        const repaired = await this.finishCandidate(candidate, diagnosis, 'experimental-index')
        if (repaired) {
          this.writeLog(`无参考实验恢复采用参数：${profile.label}`)
          return repaired
        }
        failures.push(`${profile.label}：${this.lastIndexRecoveryDetail || '解码比例不足'}`)
      } catch (error) {
        if (this.runner.isCancelled() || (error instanceof Error && error.message === 'TASK_CANCELLED')) throw error
        failures.push(`${profile.label}：${error instanceof Error ? error.message : '恢复失败'}`)
      }
      this.recoveryWarnings = warningsBeforeAttempt
    }

    const conciseFailures = failures.map((failure) => failure.replace(/\s+/g, ' ').slice(0, 260))
    for (const failure of conciseFailures) this.writeLog(`实验参数失败：${failure}`)
    const bestDecode = failures
      .map((failure) => failure.match(/仅解出 (\d+)\/(\d+) 帧（([\d.]+)%）/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .sort((left, right) => Number(right[3]) - Number(left[3]))[0]
    const bestDetail = bestDecode ? `最佳结果仅解出 ${bestDecode[1]}/${bestDecode[2]} 帧（${bestDecode[3]}%）。` : ''
    this.lastIndexRecoveryDetail = `已尝试 ${IPHONE_6_PROFILES.length} 组 iPhone 6 参数，但都未达到 50% 解码帧门槛。${bestDetail}媒体数据可能存在，但缺少正确的 SPS/PPS；仍需匹配样片或线上修复结果`
    return null
  }

  private async rebuildIndex(inputPath: string, referencePath: string, referenceProbe?: ProbeJson): Promise<string> {
    const jobDirectory = path.join(path.dirname(inputPath), `.video-repair-${randomUUID()}`)
    await mkdir(jobDirectory)
    this.temporaryPaths.add(jobDirectory)
    const inputLink = path.join(jobDirectory, `damaged${path.extname(inputPath)}`)
    const referenceLink = path.join(jobDirectory, `reference${path.extname(referencePath)}`)
    await link(inputPath, inputLink)
    await link(referencePath, referenceLink)

    const attempts: Array<{ destination: string; flags: string[]; label: string; log: string }> = []
    const standard = await this.runUntruncAttempt(jobDirectory, referenceLink, inputLink, 'rebuilt-standard.mp4', [], '正在重建视频索引…')
    attempts.push(standard)

    const standardProbe = await this.probeExistingCandidate(standard.destination)
    const standardSummary = parseUntruncSummary(standard.log)
    const needsScan = !standardProbe.hasVideo || standardSummary.prematureEnd
    if (needsScan) {
      this.writeLog('标准索引恢复提前结束，启用坏字节扫描和动态轨道统计')
      const scanned = await this.runUntruncAttempt(
        jobDirectory,
        referenceLink,
        inputLink,
        'rebuilt-scanned.mp4',
        ['-s', '-dyn', '-st', '1'],
        '正在跳过损坏数据并搜索后续画面…',
      )
      attempts.push(scanned)
    }

    const candidates: Array<{ path: string; duration: number; size: number; log: string }> = []
    for (const attempt of attempts) {
      const inspected = await this.probeExistingCandidate(attempt.destination)
      if (inspected.hasVideo) candidates.push({ path: attempt.destination, duration: inspected.duration, size: inspected.size, log: attempt.log })
    }
    candidates.sort((left, right) => right.duration - left.duration || right.size - left.size)
    if (candidates[0]) {
      const selected = candidates[0]
      const inputInfo = await stat(inputPath)
      const outputRatio = selected.size / inputInfo.size * 100
      const summary = parseUntruncSummary(selected.log)
      const referenceVideo = referenceProbe?.streams?.find((stream) => stream.codec_type === 'video')
      const referenceDescription = `${referenceVideo?.codec_name ?? '未知编码'}${referenceVideo?.width ? ` ${referenceVideo.width}×${referenceVideo.height}` : ''}`
      this.lastIndexRecoveryDetail = summary.unmatchedPercentage !== null
        ? `扫描候选中有 ${summary.unmatchedPercentage.toFixed(2)}% 的媒体字节无法按参考视频结构匹配。当前参考为 ${referenceDescription}，请更换同一设备、相同分辨率和录制设置的视频`
        : `索引重建候选未通过验证。当前参考为 ${referenceDescription}，请更换同一设备和录制设置的视频`
      if ((summary.unmatchedPercentage !== null && summary.unmatchedPercentage > 50) || outputRatio < 1) {
        this.recoveryWarnings.push(`恢复候选仅占原文件 ${outputRatio.toFixed(2)}%，${summary.unmatchedPercentage !== null ? `${summary.unmatchedPercentage.toFixed(2)}% 字节未匹配` : '恢复内容明显偏少'}`)
      }
      this.writeLog(`采用恢复候选：${path.basename(selected.path)}，时长 ${selected.duration.toFixed(2)} 秒，占原文件 ${outputRatio.toFixed(3)}%`)
      return selected.path
    }

    const referenceCodec = referenceProbe?.streams?.find((stream) => stream.codec_type === 'video')?.codec_name ?? '未知'
    throw new Error(`没有从媒体区识别出视频帧。当前参考视频编码为 ${referenceCodec}，请优先选择原设备、原分辨率和原编码的参考视频`)
  }

  private async runUntruncAttempt(
    cwd: string,
    referenceLink: string,
    inputLink: string,
    destinationName: string,
    flags: string[],
    message: string,
  ): Promise<{ destination: string; flags: string[]; label: string; log: string }> {
    const destination = path.join(cwd, destinationName)
    this.emit('rebuilding-index', message, null)
    let combinedLog = ''
    let lastUiProgress = -1
    let lastLoggedProgress = -1
    const capture = (chunk: string) => {
      const percentages = [...chunk.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)%/g)]
      const lastPercentage = percentages.at(-1)
      if (lastPercentage) {
        const percent = Math.min(100, Number(lastPercentage[1]))
        if (percent >= lastUiProgress + 0.5 || percent === 100) {
          lastUiProgress = percent
          this.emit('rebuilding-index', message, Math.min(98, percent))
        }
        if (Math.floor(percent) > lastLoggedProgress) {
          lastLoggedProgress = Math.floor(percent)
          this.writeLog(`扫描进度：${lastLoggedProgress}%`)
        }
      }
      const informative = stripUntruncProgressNoise(chunk)
      if (informative) {
        combinedLog = `${combinedLog}\n${informative}`.slice(-2_000_000)
        this.writeLog(informative)
        this.emit('rebuilding-index', message, lastUiProgress >= 0 ? Math.min(98, lastUiProgress) : null, {
          logLine: informative.split(/[\r\n]+/).at(-1),
        })
      }
    }
    const result = await this.runner.run(
      this.binaries.untrunc!,
      ['-n', ...flags, '-dst', destination, referenceLink, inputLink],
      { cwd, onStdout: capture, onStderr: capture },
    )
    if (result.code !== 0) this.writeLog(`untrunc ${flags.join(' ') || 'standard'} 退出码：${result.code}`)
    return { destination, flags, label: message, log: combinedLog }
  }

  private async probeExistingCandidate(candidate: string): Promise<{ hasVideo: boolean; duration: number; size: number }> {
    try {
      const info = await stat(candidate)
      if (info.size <= 0) return { hasVideo: false, duration: 0, size: 0 }
      const probe = await this.probe(candidate)
      const diagnosis = classifyDiagnosis(probe.stderr, probe.data)
      return {
        hasVideo: diagnosis.streams.some((stream) => stream.type === 'video'),
        duration: diagnosis.durationSeconds,
        size: info.size,
      }
    } catch {
      return { hasVideo: false, duration: 0, size: 0 }
    }
  }

  private async finishCandidate(candidate: string, diagnosis: Diagnosis, method: RepairResult['method']): Promise<RepairResult | null> {
    this.emit('verifying', '正在完整验证修复结果…', 99)
    let finalCandidate = candidate
    if (method === 'index-rebuild' || method === 'experimental-index') {
      let acceptedVerification: VerificationResult | undefined
      const normalized = this.createTemporaryOutput(candidate, 'normalized')
      const normalizedResult = await this.runFfmpeg('remuxing', diagnosis.durationSeconds, [
        '-y', '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err', '-i', candidate,
        '-map', '0:v:0?', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats', normalized,
      ])
      const normalizedVerification = normalizedResult.code === 0 ? await this.verify(normalized, true) : undefined
      if (normalizedVerification?.valid) {
        finalCandidate = normalized
        acceptedVerification = normalizedVerification
      }
      else {
        const originalVerification = await this.verify(candidate, true)
        if (originalVerification.valid) {
          finalCandidate = candidate
          acceptedVerification = originalVerification
        } else {
          const detail = originalVerification.reason ?? normalizedVerification?.reason ?? '没有解出有效视频帧'
          this.lastIndexRecoveryDetail = this.lastIndexRecoveryDetail
            ? `${this.lastIndexRecoveryDetail}；解码验证：${detail}`
            : `索引恢复结果未通过解码验证：${detail}`
          this.writeLog(this.lastIndexRecoveryDetail)
          return null
        }
      }
      if (acceptedVerification?.decodeRatio !== null && acceptedVerification?.decodeRatio !== undefined
        && acceptedVerification.decodeRatio < 0.95 && acceptedVerification.expectedFrames) {
        this.recoveryWarnings.push(
          `恢复结果解出 ${acceptedVerification.decodedFrames}/${acceptedVerification.expectedFrames} 帧（${(acceptedVerification.decodeRatio * 100).toFixed(1)}%），部分画面仍有损坏`,
        )
      }
    } else {
      const verification = await this.verify(candidate)
      if (!verification.valid || !verification.probe) {
        this.writeLog(`验证未通过：${verification.reason ?? '未知错误'}`)
        return null
      }
    }

    const actualOutput = await uniqueOutputPath(this.currentInputForOutput ?? candidate)
    await rename(finalCandidate, actualOutput)
    this.lastOutputPath = actualOutput
    this.temporaryPaths.delete(finalCandidate)
    const finalProbe = await this.probe(actualOutput)
    const finalDiagnosis = classifyDiagnosis(finalProbe.stderr, finalProbe.data)
    this.emit('success', '修复完成，结果已通过解码验证', 100)
    return {
      success: true,
      stage: 'success',
      method,
      outputPath: actualOutput,
      durationSeconds: finalDiagnosis.durationSeconds,
      streams: finalDiagnosis.streams,
      skippedErrors: this.errorCount,
      diagnosis,
      warnings: this.recoveryWarnings,
      logPath: this.logPath,
    }
  }

  private currentInputForOutput: string | null = null

  private async verify(candidate: string, tolerateDecodeErrors = false): Promise<VerificationResult> {
    const probe = await this.probe(candidate)
    const diagnosis = classifyDiagnosis(probe.stderr, probe.data)
    if (probe.code !== 0 || !probe.data || !diagnosis.streams.some((stream) => stream.type === 'video') || diagnosis.durationSeconds <= 0) {
      return { valid: false, probe: probe.data, reason: diagnosis.summary }
    }
    const decodeArgs = ['-v', 'error']
    if (!tolerateDecodeErrors) decodeArgs.push('-xerror')
    decodeArgs.push('-i', candidate, '-map', '0:v:0', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-')
    const decode = await this.runner.run(this.binaries.ffmpeg, decodeArgs, { onStderr: (chunk) => this.captureErrors(chunk) })
    const decodedFrames = [...decode.stdout.matchAll(/(?:^|\n)frame=(\d+)/g)].reduce((max, match) => Math.max(max, Number(match[1])), 0)
    const videoStream = probe.data.streams?.find((stream) => stream.codec_type === 'video')
    const quality = calculateDecodeQuality(
      diagnosis.durationSeconds,
      videoStream?.avg_frame_rate || videoStream?.r_frame_rate,
      decodedFrames,
    )
    let reason: string | undefined
    if (decodedFrames === 0) {
      reason = '没有解出视频帧'
    } else if (tolerateDecodeErrors && !quality.acceptable && quality.expectedFrames && quality.ratio !== null) {
      reason = `仅解出 ${decodedFrames}/${quality.expectedFrames} 帧（${(quality.ratio * 100).toFixed(1)}%），参考视频与原视频参数很可能不匹配`
    } else if (!tolerateDecodeErrors && decode.code !== 0) {
      reason = '完整解码验证失败'
    }
    const valid = tolerateDecodeErrors ? quality.acceptable : decode.code === 0 && decodedFrames > 0
    return {
      valid,
      probe: probe.data,
      reason,
      decodedFrames,
      expectedFrames: quality.expectedFrames,
      decodeRatio: quality.ratio,
    }
  }

  private createTemporaryOutput(inputPath: string, label: string): string {
    if (!this.currentInputForOutput) this.currentInputForOutput = inputPath
    const output = path.join(path.dirname(inputPath), `.${path.basename(inputPath, path.extname(inputPath))}.${label}-${randomUUID()}.partial.mp4`)
    this.temporaryPaths.add(output)
    return output
  }

  private async ensureDiskSpace(inputPath: string): Promise<void> {
    const file = await stat(inputPath)
    const disk = await statfs(path.dirname(inputPath))
    const available = Number(disk.bavail) * Number(disk.bsize)
    const required = Math.max(512 * 1024 * 1024, Math.ceil(file.size * 1.15))
    if (available < required) throw new Error(`磁盘空间不足，至少需要约 ${this.formatBytes(required)} 可用空间`)
  }

  private formatBytes(bytes: number): string {
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`
  }

  private emit(stage: RepairStage, message: string, percent: number | null, extra: Partial<RepairProgress> = {}): void {
    this.currentStage = stage
    this.currentMessage = message
    this.sendProgress({
      stage,
      percent,
      processedSeconds: extra.processedSeconds ?? 0,
      speed: extra.speed ?? '',
      elapsedSeconds: (Date.now() - this.startedAt) / 1000,
      message,
      logLine: extra.logLine,
      diagnosis: extra.diagnosis,
    })
  }

  private captureLog(chunk: string): void {
    this.writeLog(chunk.trimEnd())
    const line = chunk.trim().split(/\r?\n/).at(-1)
    if (line) this.emit('rebuilding-index', '正在根据参考视频重建索引…', null, { logLine: line })
  }

  private captureErrors(chunk: string): void {
    this.errorCount += countMediaErrors(chunk)
    this.writeLog(chunk.trimEnd())
    const line = chunk.trim().split(/\r?\n/).at(-1)
    if (line) this.emit(this.currentStage, this.currentMessage, null, { logLine: line })
  }

  private writeLog(message: string): void {
    if (!message) return
    appendFileSync(this.logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  }

  private result(success: boolean, stage: RepairStage, diagnosis?: Diagnosis, reason?: string): RepairResult {
    return { success, stage, skippedErrors: this.errorCount, diagnosis, reason, logPath: this.logPath }
  }

  private async safeRemove(target: string): Promise<void> {
    try {
      await access(target)
      await rm(target, { recursive: true, force: true })
    } catch {
      // The process may not have created its target.
    }
    this.temporaryPaths.delete(target)
  }

  private async cleanup(): Promise<void> {
    for (const target of [...this.temporaryPaths]) await this.safeRemove(target)
    this.currentInputForOutput = null
  }
}
