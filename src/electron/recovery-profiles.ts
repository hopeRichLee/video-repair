import type { RecoveryCodec, RecoveryHints } from '../shared/types.js'

export interface RecoveryProfile {
  id: string
  label: string
  codec: RecoveryCodec
  width: 1280 | 1920 | 3840
  height: 720 | 1080 | 2160
  frameRate: 30 | 60
  level: string
  videoBitrate: string
}

export const RECOVERY_PROFILE_VERSION = 1

export const RECOVERY_PROFILES: RecoveryProfile[] = [
  { id: 'h264-1080p30', label: 'H.264 · 1080p · 30 fps', codec: 'h264', width: 1920, height: 1080, frameRate: 30, level: '4.0', videoBitrate: '17M' },
  { id: 'h264-1080p60', label: 'H.264 · 1080p · 60 fps', codec: 'h264', width: 1920, height: 1080, frameRate: 60, level: '4.2', videoBitrate: '26M' },
  { id: 'h264-720p30', label: 'H.264 · 720p · 30 fps', codec: 'h264', width: 1280, height: 720, frameRate: 30, level: '3.1', videoBitrate: '10M' },
  { id: 'hevc-1080p30', label: 'H.265 · 1080p · 30 fps', codec: 'hevc', width: 1920, height: 1080, frameRate: 30, level: '4.0', videoBitrate: '12M' },
  { id: 'hevc-1080p60', label: 'H.265 · 1080p · 60 fps', codec: 'hevc', width: 1920, height: 1080, frameRate: 60, level: '4.1', videoBitrate: '20M' },
  { id: 'h264-4k30', label: 'H.264 · 4K · 30 fps', codec: 'h264', width: 3840, height: 2160, frameRate: 30, level: '5.1', videoBitrate: '45M' },
  { id: 'hevc-4k30', label: 'H.265 · 4K · 30 fps', codec: 'hevc', width: 3840, height: 2160, frameRate: 30, level: '5.1', videoBitrate: '30M' },
  { id: 'hevc-4k60', label: 'H.265 · 4K · 60 fps', codec: 'hevc', width: 3840, height: 2160, frameRate: 60, level: '5.1', videoBitrate: '55M' },
]

export function selectRecoveryProfiles(hints?: RecoveryHints): RecoveryProfile[] {
  return RECOVERY_PROFILES.filter((profile) => (
    (!hints?.codec || profile.codec === hints.codec)
    && (!hints?.width || profile.width === hints.width)
    && (!hints?.height || profile.height === hints.height)
    && (!hints?.frameRate || profile.frameRate === hints.frameRate)
  ))
}
