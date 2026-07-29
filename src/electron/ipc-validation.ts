import type { StartRepairRequest } from '../shared/types.js'

export function validateStartRepairRequest(request: unknown): asserts request is StartRepairRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('修复请求格式无效')
  const value = request as Record<string, unknown>
  const allowedKeys = new Set(['inputPath', 'referencePath', 'experimentalRecovery'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))
    || typeof value.inputPath !== 'string'
    || (value.referencePath !== undefined && typeof value.referencePath !== 'string')
    || (value.experimentalRecovery !== undefined && typeof value.experimentalRecovery !== 'boolean')
    || (value.referencePath !== undefined && value.experimentalRecovery === true)) {
    throw new Error('修复请求格式无效')
  }
}
