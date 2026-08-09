export const SUPPORTED_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.3gp'] as const

export type RepairStage =
  | 'idle'
  | 'diagnosing'
  | 'needs-reference'
  | 'rebuilding-index'
  | 'remuxing'
  | 'transcoding'
  | 'verifying'
  | 'success'
  | 'failed'
  | 'cancelled'

export type DiagnosisCategory =
  | 'healthy'
  | 'missing-index'
  | 'timestamp-error'
  | 'corrupt-packets'
  | 'decode-error'
  | 'truncated'
  | 'no-media'
  | 'unknown'

export interface MediaStream {
  index: number
  type: 'video' | 'audio' | 'other'
  codec: string
  width?: number
  height?: number
  frameRate?: string
  channels?: number
  sampleRate?: number
}

export interface Diagnosis {
  category: DiagnosisCategory
  summary: string
  detail: string
  durationSeconds: number
  format: string
  streams: MediaStream[]
  needsReference: boolean
}

export interface RepairProgress {
  stage: RepairStage
  percent: number | null
  processedSeconds: number
  speed: string
  elapsedSeconds: number
  message: string
  logLine?: string
  diagnosis?: Diagnosis
  recoveryAttempt?: {
    index: number
    total: number
    label: string
  }
}

export type RecoveryCodec = 'h264' | 'hevc'

export interface RecoveryHints {
  codec?: RecoveryCodec
  width?: 1280 | 1920 | 3840
  height?: 720 | 1080 | 2160
  frameRate?: 30 | 60
}

export interface StartRepairRequest {
  inputPath: string
  referencePath?: string
  experimentalRecovery?: boolean
  recoveryHints?: RecoveryHints
}

export interface PreflightRepairRequest {
  inputPath: string
  referencePath?: string
}

export interface RepairPreflight {
  inputPath: string
  fileName: string
  fileSizeBytes: number
  modifiedAt: string
  diagnosis: Diagnosis
  diskSpace: {
    availableBytes: number
    requiredBytes: number
    sufficient: boolean
  }
  recommendedStrategy: 'remux' | 'index-rebuild' | 'unavailable'
  strategyReason: string
  canStart: boolean
  reference?: {
    path: string
    compatible: boolean
    reason?: string
    diagnosis?: Diagnosis
  }
}

export interface RepairVerification {
  status: 'passed' | 'warning'
  outputSizeBytes: number
  durationSeconds: number
  decodedFrames: number
  expectedFrames: number | null
  decodeRatio: number | null
  durationRetentionRatio: number | null
  errorCount: number
  warnings: string[]
}

export interface RepairResult {
  success: boolean
  stage: RepairStage
  method?: 'remux' | 'index-rebuild' | 'experimental-index' | 'transcode'
  outputPath?: string
  durationSeconds?: number
  streams?: MediaStream[]
  skippedErrors: number
  diagnosis?: Diagnosis
  reason?: string
  warnings?: string[]
  logPath?: string
  verification?: RepairVerification
}

export interface RepairHistoryEntry {
  id: string
  inputPath: string
  outputPath?: string
  startedAt: string
  finishedAt: string
  success: boolean
  stage: RepairStage
  method?: RepairResult['method']
  reason?: string
  warnings?: string[]
  verification?: RepairVerification
}

export interface DesktopApi {
  selectInput(): Promise<string | null>
  selectReference(): Promise<string | null>
  getDroppedFilePath(file: File): string
  preflightRepair(request: PreflightRepairRequest): Promise<RepairPreflight>
  startRepair(request: StartRepairRequest): Promise<RepairResult>
  cancelRepair(): Promise<boolean>
  openOutput(path: string): Promise<void>
  openOutputFolder(path: string): Promise<void>
  exportLog(logPath?: string): Promise<string | null>
  copyText(text: string): Promise<void>
  listRepairHistory(): Promise<RepairHistoryEntry[]>
  removeRepairHistoryEntry(id: string): Promise<boolean>
  clearRepairHistory(): Promise<void>
  onProgress(callback: (progress: RepairProgress) => void): void
  removeProgressListeners(): void
}
