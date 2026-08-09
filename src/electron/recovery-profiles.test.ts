import { describe, expect, it } from 'vitest'
import { RECOVERY_PROFILES, selectRecoveryProfiles } from './recovery-profiles.js'

describe('recovery profiles', () => {
  it('contains the eight supported AVC and HEVC combinations', () => {
    expect(RECOVERY_PROFILES).toHaveLength(8)
    expect(RECOVERY_PROFILES.filter((profile) => profile.codec === 'h264')).toHaveLength(4)
    expect(RECOVERY_PROFILES.filter((profile) => profile.codec === 'hevc')).toHaveLength(4)
  })

  it('filters by partial and exact hints without changing priority order', () => {
    expect(selectRecoveryProfiles({ codec: 'hevc' }).map((profile) => profile.id)).toEqual([
      'hevc-1080p30', 'hevc-1080p60', 'hevc-4k30', 'hevc-4k60',
    ])
    expect(selectRecoveryProfiles({ codec: 'h264', width: 1920, height: 1080, frameRate: 60 })).toHaveLength(1)
    expect(selectRecoveryProfiles({ codec: 'h264', width: 3840, height: 2160, frameRate: 60 })).toEqual([])
  })
})
