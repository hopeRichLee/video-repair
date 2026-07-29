import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { SUPPORTED_EXTENSIONS, type Diagnosis, type DiagnosisCategory, type MediaStream } from '../shared/types.js'

export interface ProbeStream {
  index?: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  channels?: number
  sample_rate?: string
  duration?: string
}

export interface ProbeJson {
  streams?: ProbeStream[]
  format?: {
    format_name?: string
    duration?: string
    size?: string
  }
}

const RULES: Array<{ category: DiagnosisCategory; pattern: RegExp; summary: string }> = [
  { category: 'missing-index', pattern: /moov atom not found|could not find codec parameters.*unspecified size/i, summary: '视频索引缺失，需要同设备的正常视频作为参考' },
  { category: 'timestamp-error', pattern: /non[- ]monotonous|invalid.*timestamp|dts .* out of order|missing.*pts/i, summary: '视频时间戳异常，可以尝试重新生成时间轴' },
  { category: 'corrupt-packets', pattern: /corrupt|invalid nal|error splitting|packet.*invalid/i, summary: '检测到损坏的数据包，将尝试跳过坏片段' },
  { category: 'decode-error', pattern: /error while decoding|decode_slice_header|no frame|could not find codec/i, summary: '部分画面无法解码，需要进行容错转码' },
  { category: 'truncated', pattern: /end of file|partial file|truncat|input buffer exhausted/i, summary: '文件可能被截断，将尽量抢救现有内容' },
]

export function mapStreams(probe?: ProbeJson): MediaStream[] {
  return (probe?.streams ?? []).map((stream, fallbackIndex) => ({
    index: stream.index ?? fallbackIndex,
    type: stream.codec_type === 'video' || stream.codec_type === 'audio' ? stream.codec_type : 'other',
    codec: stream.codec_name ?? '未知',
    width: stream.width,
    height: stream.height,
    frameRate: stream.avg_frame_rate || stream.r_frame_rate,
    channels: stream.channels,
    sampleRate: stream.sample_rate ? Number(stream.sample_rate) : undefined,
  }))
}

export function probeDuration(probe?: ProbeJson): number {
  const values = [
    Number(probe?.format?.duration ?? 0),
    ...(probe?.streams ?? []).map((stream) => Number(stream.duration ?? 0)),
  ].filter((value) => Number.isFinite(value) && value > 0)
  return values.length ? Math.max(...values) : 0
}

export function classifyDiagnosis(stderr: string, probe?: ProbeJson): Diagnosis {
  const streams = mapStreams(probe)
  const hasVideo = streams.some((stream) => stream.type === 'video')
  const matched = RULES.find((rule) => rule.pattern.test(stderr))
  let category: DiagnosisCategory = matched?.category ?? (hasVideo ? 'healthy' : 'no-media')
  let summary = matched?.summary ?? (hasVideo ? '已识别视频轨道，将先尝试无损修复' : '没有找到有效的视频轨道')

  if (!hasVideo && category !== 'missing-index') {
    category = 'no-media'
    summary = '没有找到有效的视频轨道'
  }

  return {
    category,
    summary,
    detail: stderr.trim().split(/\r?\n/).slice(-8).join('\n'),
    durationSeconds: probeDuration(probe),
    format: probe?.format?.format_name ?? '未知',
    streams,
    needsReference: category === 'missing-index',
  }
}

export function parseProgressBlock(block: string, durationSeconds: number): { percent: number | null; processedSeconds: number; speed: string } {
  const entries = new Map<string, string>()
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) entries.set(line.slice(0, separator), line.slice(separator + 1))
  }
  const microseconds = Number(entries.get('out_time_ms') ?? 0)
  const processedSeconds = Number.isFinite(microseconds) ? microseconds / 1_000_000 : 0
  const percent = durationSeconds > 0 ? Math.min(99, Math.max(0, processedSeconds / durationSeconds * 100)) : null
  return { percent, processedSeconds, speed: entries.get('speed') ?? '' }
}

export interface DecodeQuality {
  decodedFrames: number
  expectedFrames: number | null
  ratio: number | null
  acceptable: boolean
}

export function parseFrameRate(value?: string): number | null {
  if (!value) return null
  const [numeratorText, denominatorText = '1'] = value.split('/')
  const numerator = Number(numeratorText)
  const denominator = Number(denominatorText)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null
  const rate = numerator / denominator
  return rate >= 1 && rate <= 240 ? rate : null
}

export function calculateDecodeQuality(
  durationSeconds: number,
  frameRate: string | undefined,
  decodedFrames: number,
  minimumRatio = 0.5,
): DecodeQuality {
  const rate = parseFrameRate(frameRate)
  if (!rate || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { decodedFrames, expectedFrames: null, ratio: null, acceptable: decodedFrames > 0 }
  }
  const expectedFrames = Math.max(1, Math.round(durationSeconds * rate))
  const ratio = Math.min(1, decodedFrames / expectedFrames)
  return { decodedFrames, expectedFrames, ratio, acceptable: decodedFrames > 0 && ratio >= minimumRatio }
}

export function areReferencesCompatible(damaged: ProbeJson | undefined, reference: ProbeJson): { compatible: boolean; reason?: string } {
  const referenceVideo = reference.streams?.find((stream) => stream.codec_type === 'video')
  if (!referenceVideo) return { compatible: false, reason: '参考文件中没有视频轨道' }
  const damagedVideo = damaged?.streams?.find((stream) => stream.codec_type === 'video')
  if (!damagedVideo) return { compatible: true }
  if (damagedVideo.codec_name && referenceVideo.codec_name && damagedVideo.codec_name !== referenceVideo.codec_name) {
    return { compatible: false, reason: '参考视频与损坏视频的编码格式不同' }
  }
  if (damagedVideo.width && referenceVideo.width && (damagedVideo.width !== referenceVideo.width || damagedVideo.height !== referenceVideo.height)) {
    return { compatible: false, reason: '参考视频与损坏视频的分辨率不同' }
  }
  return { compatible: true }
}

export async function validateMediaPath(filePath: string): Promise<string> {
  if (!path.isAbsolute(filePath)) throw new Error('请选择本地视频文件')
  const resolved = path.resolve(filePath)
  const extension = path.extname(resolved).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.includes(extension as typeof SUPPORTED_EXTENSIONS[number])) {
    throw new Error('仅支持 MP4、MOV、M4V 和 3GP 文件')
  }
  await access(resolved, constants.R_OK)
  const info = await stat(resolved)
  if (!info.isFile()) throw new Error('选择的路径不是文件')
  if (info.size === 0) throw new Error('文件为空，没有可恢复的视频数据')
  return resolved
}

export async function uniqueOutputPath(inputPath: string): Promise<string> {
  const directory = path.dirname(inputPath)
  const baseName = path.basename(inputPath, path.extname(inputPath))
  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? '' : ` (${index})`
    const candidate = path.join(directory, `${baseName}_已修复${suffix}.mp4`)
    try {
      await access(candidate)
    } catch {
      return candidate
    }
  }
  throw new Error('无法生成可用的输出文件名')
}

export function countMediaErrors(text: string): number {
  return (text.match(/corrupt|error while decoding|invalid nal|decode_slice_header|number of scalefactor bands|reserved bit set/gi) ?? []).length
}

export interface UntruncSummary {
  prematureEnd: boolean
  prematurePercentage: number | null
  videoPackets: number
  unmatchedPercentage: number | null
}

export function parseUntruncSummary(text: string): UntruncSummary {
  const prematureMatch = text.match(/premature end\s*\(~([\d.]+)%\)/i)
  const unmatchedMatch = text.match(/Bytes NOT matched:[^(]*\(([\d.]+)%\)/i)
  const packetLines = [...text.matchAll(/Found\s+\d+\s+packets\s*\(([^)]+)\)/gi)]
  let videoPackets = 0
  for (const packetLine of packetLines) {
    for (const match of packetLine[1].matchAll(/(?:avc1|h264|hvc1|hev1|mp4v|jpeg)(?:-keyframes)?:\s*(\d+)/gi)) {
      videoPackets += Number(match[1]) || 0
    }
  }
  return {
    prematureEnd: /unable to find correct codec\s*->\s*premature end/i.test(text),
    prematurePercentage: prematureMatch ? Number(prematureMatch[1]) : null,
    videoPackets,
    unmatchedPercentage: unmatchedMatch ? Number(unmatchedMatch[1]) : null,
  }
}

export function stripUntruncProgressNoise(text: string): string {
  return text
    .split(/[\r\n]+/)
    .filter((line) => !/^\s*(?:\d+(?:\.\d+)?%\s*)+$/.test(line))
    .join('\n')
    .trim()
}
