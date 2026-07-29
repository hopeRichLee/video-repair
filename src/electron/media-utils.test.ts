import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  areReferencesCompatible,
  calculateDecodeQuality,
  classifyDiagnosis,
  parseFrameRate,
  parseProgressBlock,
  parseUntruncSummary,
  stripUntruncProgressNoise,
  uniqueOutputPath,
} from './media-utils.js'

describe('classifyDiagnosis', () => {
  it('recognizes a missing MP4 index', () => {
    const result = classifyDiagnosis('moov atom not found')
    expect(result.category).toBe('missing-index')
    expect(result.needsReference).toBe(true)
  })

  it('recognizes timestamp errors when a video stream exists', () => {
    const result = classifyDiagnosis('Non-monotonous DTS in output stream', {
      streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }],
      format: { duration: '12.5', format_name: 'mov,mp4' },
    })
    expect(result.category).toBe('timestamp-error')
    expect(result.durationSeconds).toBe(12.5)
  })

  it('does not call an audio-only file healthy', () => {
    const result = classifyDiagnosis('', { streams: [{ codec_type: 'audio', codec_name: 'aac' }] })
    expect(result.category).toBe('no-media')
  })
})

describe('parseProgressBlock', () => {
  it('converts FFmpeg microseconds to a bounded percentage', () => {
    expect(parseProgressBlock('out_time_ms=5000000\nspeed=1.25x\nprogress=continue\n', 10)).toEqual({
      percent: 50,
      processedSeconds: 5,
      speed: '1.25x',
    })
  })
})

describe('decode quality', () => {
  it('parses rational frame rates', () => {
    expect(parseFrameRate('196200/6539')).toBeCloseTo(30.005, 2)
    expect(parseFrameRate('0/0')).toBeNull()
  })

  it('rejects a candidate that only decodes a tiny fraction of its expected frames', () => {
    const quality = calculateDecodeQuality(10.898, '30/1', 7)
    expect(quality.expectedFrames).toBe(327)
    expect(quality.ratio).toBeCloseTo(7 / 327)
    expect(quality.acceptable).toBe(false)
  })

  it('accepts a mostly decodable recovery despite a few damaged frames', () => {
    expect(calculateDecodeQuality(10, '30/1', 280).acceptable).toBe(true)
  })
})

describe('parseUntruncSummary', () => {
  it('detects an early stop and counts video packets', () => {
    const result = parseUntruncSummary('Error: unable to find correct codec -> premature end (~0.001683%)\nInfo: Found 88 packets ( mp4a: 87 hvc1: 0 hvc1-keyframes: 0 )')
    expect(result).toEqual({ prematureEnd: true, prematurePercentage: 0.001683, videoPackets: 0, unmatchedPercentage: null })
  })

  it('counts AVC packets in a successful scan', () => {
    expect(parseUntruncSummary('Found 240 packets ( avc1: 200 avc1-keyframes: 4 mp4a: 36 )').videoPackets).toBe(204)
  })

  it('does not treat reaching the physical end of a truncated mdat as an unknown-codec stop', () => {
    expect(parseUntruncSummary('Warning: reached premature end of mdat').prematureEnd).toBe(false)
  })

  it('extracts the unmatched media percentage', () => {
    expect(parseUntruncSummary('Warning: Bytes NOT matched: 1.17GiB (99.85%)').unmatchedPercentage).toBe(99.85)
  })
})

describe('stripUntruncProgressNoise', () => {
  it('removes repeated progress-only lines but keeps diagnostics', () => {
    expect(stripUntruncProgressNoise('93.5%\r93.5%\nWarning: Bytes NOT matched: 1 GiB (99.8%)\n100%')).toBe('Warning: Bytes NOT matched: 1 GiB (99.8%)')
  })
})

describe('areReferencesCompatible', () => {
  it('rejects a different codec', () => {
    const result = areReferencesCompatible(
      { streams: [{ codec_type: 'video', codec_name: 'h264' }] },
      { streams: [{ codec_type: 'video', codec_name: 'hevc' }] },
    )
    expect(result.compatible).toBe(false)
  })

  it('accepts a reference when the damaged file has no readable streams', () => {
    const result = areReferencesCompatible(undefined, {
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 }],
    })
    expect(result.compatible).toBe(true)
  })
})

describe('uniqueOutputPath', () => {
  it('adds a number when an output already exists', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'video-repair-'))
    const input = path.join(directory, '样本.mov')
    await writeFile(path.join(directory, '样本_已修复.mp4'), 'occupied')
    await expect(uniqueOutputPath(input)).resolves.toBe(path.join(directory, '样本_已修复 (1).mp4'))
  })
})
