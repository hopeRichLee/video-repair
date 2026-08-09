import type { PreflightRepairRequest, RecoveryHints, StartRepairRequest } from '../shared/types.js'

function validateRecoveryHints(value: unknown): value is RecoveryHints {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const hints = value as Record<string, unknown>
  const allowedKeys = new Set(['codec', 'width', 'height', 'frameRate'])
  const validDimensions = (
    (hints.width === undefined && hints.height === undefined)
    || (hints.width === 1280 && hints.height === 720)
    || (hints.width === 1920 && hints.height === 1080)
    || (hints.width === 3840 && hints.height === 2160)
  )
  return !Object.keys(hints).some((key) => !allowedKeys.has(key))
    && (hints.codec === undefined || hints.codec === 'h264' || hints.codec === 'hevc')
    && validDimensions
    && (hints.frameRate === undefined || hints.frameRate === 30 || hints.frameRate === 60)
}

export function validateStartRepairRequest(request: unknown): asserts request is StartRepairRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('修复请求格式无效')
  const value = request as Record<string, unknown>
  const allowedKeys = new Set(['inputPath', 'referencePath', 'experimentalRecovery', 'recoveryHints'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))
    || typeof value.inputPath !== 'string'
    || (value.referencePath !== undefined && typeof value.referencePath !== 'string')
    || (value.experimentalRecovery !== undefined && typeof value.experimentalRecovery !== 'boolean')
    || (value.recoveryHints !== undefined && !validateRecoveryHints(value.recoveryHints))
    || (value.referencePath !== undefined && value.experimentalRecovery === true)
    || (value.recoveryHints !== undefined && value.experimentalRecovery !== true)) {
    throw new Error('修复请求格式无效')
  }
}

export function validatePreflightRepairRequest(request: unknown): asserts request is PreflightRepairRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('预检请求格式无效')
  const value = request as Record<string, unknown>
  const allowedKeys = new Set(['inputPath', 'referencePath'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))
    || typeof value.inputPath !== 'string'
    || (value.referencePath !== undefined && typeof value.referencePath !== 'string')) {
    throw new Error('预检请求格式无效')
  }
}
