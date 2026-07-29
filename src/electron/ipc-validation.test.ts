import { describe, expect, it } from 'vitest'
import { validateStartRepairRequest } from './ipc-validation.js'

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
})
