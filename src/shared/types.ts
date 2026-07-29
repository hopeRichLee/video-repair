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
}

export interface StartRepairRequest {
  inputPath: string
  referencePath?: string
  experimentalRecovery?: boolean
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
}

export interface DesktopApi {
  selectInput(): Promise<string | null>
  selectReference(): Promise<string | null>
  getDroppedFilePath(file: File): string
  startRepair(request: StartRepairRequest): Promise<RepairResult>
  cancelRepair(): Promise<boolean>
  openOutput(path: string): Promise<void>
  openOutputFolder(path: string): Promise<void>
  exportLog(logPath?: string): Promise<string | null>
  copyText(text: string): Promise<void>
  onProgress(callback: (progress: RepairProgress) => void): void
  removeProgressListeners(): void
}
