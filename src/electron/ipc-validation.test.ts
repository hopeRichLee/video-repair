import { describe, expect, it } from 'vitest'
import { validatePreflightRepairRequest, validateStartRepairRequest } from './ipc-validation.js'

describe('validateStartRepairRequest', () => {
  it('accepts the experimental recovery flag without a reference path', () => {
    expect(() => validateStartRepairRequest({ inputPath: 'C:\\video.mov', experimentalRecovery: true })).not.toThrow()
  })

  it('rejects non-boolean flags and unknown fields', () => {
    expect(() => validateStartRepairRequest({ inputPath: 'C:\\video.mov', experimentalRecovery: 'yes' })).toThrow()
    expect(() => validateStartRepairRequest({ inputPath: 'C:\\video.mov', executable: 'cmd.exe' })).toThrow()
  })

  it('rejects selecting both recovery modes', () => {
    expect(() => validateStartRepairRequest({
      inputPath: 'C:\\video.mov',
      referencePath: 'C:\\reference.mov',
      experimentalRecovery: true,
    })).toThrow()
  })

  it('validates recovery hints only for experimental recovery', () => {
    expect(() => validateStartRepairRequest({
      inputPath: 'C:\\video.mov', experimentalRecovery: true,
      recoveryHints: { codec: 'hevc', width: 3840, height: 2160, frameRate: 60 },
    })).not.toThrow()
    expect(() => validateStartRepairRequest({ inputPath: 'C:\\video.mov', recoveryHints: { codec: 'h264' } })).toThrow()
    expect(() => validateStartRepairRequest({
      inputPath: 'C:\\video.mov', experimentalRecovery: true,
      recoveryHints: { width: 1920, height: 720 },
    })).toThrow()
  })

  it('accepts only input and optional reference paths for preflight', () => {
    expect(() => validatePreflightRepairRequest({ inputPath: 'C:\\video.mov' })).not.toThrow()
    expect(() => validatePreflightRepairRequest({ inputPath: 'C:\\video.mov', debug: true })).toThrow()
  })
})
