import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, ChevronDown, ChevronRight, CircleAlert, Clipboard, Clock3, FileSearch,
  FileVideo2, FolderOpen, Gauge, HardDrive, History, LoaderCircle, Play, RotateCcw,
  Save, ShieldCheck, Square, Trash2, Upload, Wrench, X,
} from 'lucide-react'
import type {
  Diagnosis, RecoveryHints, RepairHistoryEntry, RepairPreflight, RepairProgress,
  RepairResult, RepairStage,
} from '../shared/types'

type UiStage = RepairStage | 'ready'

const BUSY_STAGES: UiStage[] = ['diagnosing', 'rebuilding-index', 'remuxing', 'transcoding', 'verifying']
const STAGE_LABELS: Record<UiStage, string> = {
  idle: '等待文件', ready: '预检完成', diagnosing: '预检中', 'needs-reference': '需要参考视频',
  'rebuilding-index': '重建索引', remuxing: '无损修复', transcoding: '深度抢救',
  verifying: '验证结果', success: '修复完成', failed: '处理失败', cancelled: '已取消',
}

const METHOD_LABELS: Record<NonNullable<RepairResult['method']>, string> = {
  remux: '无损重封装', 'index-rebuild': '参考索引重建',
  'experimental-index': '无参考实验恢复', transcode: '容错转码',
}

const PROFILE_COMBINATIONS = [
  ['h264', 1280, 30], ['h264', 1920, 30], ['h264', 1920, 60], ['h264', 3840, 30],
  ['hevc', 1920, 30], ['hevc', 1920, 60], ['hevc', 3840, 30], ['hevc', 3840, 60],
] as const

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function formatDuration(seconds = 0): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '未知'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const secs = Math.floor(seconds % 60)
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

function formatBytes(bytes = 0): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? '未知' : `${(value * 100).toFixed(1)}%`
}

function formatFrameRate(value?: string): string {
  if (!value) return ''
  const [numerator, denominator = 1] = value.split('/').map(Number)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator <= 0) return ''
  const rate = numerator / denominator
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(2)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function diagnosisText(diagnosis?: Diagnosis): string {
  if (!diagnosis) return ''
  const streams = diagnosis.streams.map((stream) => {
    const dimensions = stream.width ? ` ${stream.width}×${stream.height}` : ''
    return `${stream.type === 'video' ? '视频' : stream.type === 'audio' ? '音频' : '其他'}：${stream.codec}${dimensions}`
  })
  return [diagnosis.summary, `容器：${diagnosis.format}`, `时长：${formatDuration(diagnosis.durationSeconds)}`, ...streams].join('\n')
}

export function App() {
  const [inputPath, setInputPath] = useState('')
  const [referencePath, setReferencePath] = useState('')
  const [preflight, setPreflight] = useState<RepairPreflight | null>(null)
  const [preflightError, setPreflightError] = useState('')
  const [preflighting, setPreflighting] = useState(false)
  const [stage, setStage] = useState<UiStage>('idle')
  const [progress, setProgress] = useState<RepairProgress | null>(null)
  const [result, setResult] = useState<RepairResult | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<RepairHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [experimentalOpen, setExperimentalOpen] = useState(false)
  const [hintCodec, setHintCodec] = useState<'' | 'h264' | 'hevc'>('')
  const [hintResolution, setHintResolution] = useState<'' | '720' | '1080' | '2160'>('')
  const [hintFrameRate, setHintFrameRate] = useState<'' | '30' | '60'>('')
  const preflightSequence = useRef(0)

  const busy = BUSY_STAGES.includes(stage)
  const diagnosis = result?.diagnosis ?? preflight?.diagnosis
  const summary = useMemo(() => diagnosisText(diagnosis), [diagnosis])
  const needsReference = Boolean(preflight?.diagnosis.needsReference)
  const referenceInvalid = Boolean(referencePath && preflight?.reference && !preflight.reference.compatible)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try { setHistory(await window.videoRepair.listRepairHistory()) }
    finally { setHistoryLoading(false) }
  }, [])

  useEffect(() => {
    window.videoRepair.onProgress((next) => {
      setProgress(next)
      setStage(next.stage)
      if (next.logLine) setLogs((current) => [...current.slice(-299), next.logLine!])
    })
    void loadHistory()
    return () => window.videoRepair.removeProgressListeners()
  }, [loadHistory])

  const runPreflight = useCallback(async (selected: string, reference?: string) => {
    const sequence = ++preflightSequence.current
    setPreflighting(true)
    setPreflightError('')
    setPreflight(null)
    setResult(null)
    setProgress(null)
    setStage('diagnosing')
    try {
      const next = await window.videoRepair.preflightRepair({ inputPath: selected, referencePath: reference || undefined })
      if (sequence !== preflightSequence.current) return
      setPreflight(next)
      setStage(next.canStart ? 'ready' : next.diagnosis.needsReference ? 'needs-reference' : 'failed')
    } catch (error) {
      if (sequence !== preflightSequence.current) return
      setPreflightError(error instanceof Error ? error.message : '无法完成视频预检')
      setStage('failed')
    } finally {
      if (sequence === preflightSequence.current) setPreflighting(false)
    }
  }, [])

  const resetWithFile = (selected: string) => {
    preflightSequence.current += 1
    setInputPath(selected)
    setReferencePath('')
    setPreflight(null)
    setPreflightError('')
    setProgress(null)
    setResult(null)
    setLogs([])
    setLogsOpen(false)
    setStage(selected ? 'diagnosing' : 'idle')
    if (selected) void runPreflight(selected)
  }

  const selectInput = async () => {
    const selected = await window.videoRepair.selectInput()
    if (selected) resetWithFile(selected)
  }

  const selectReference = async () => {
    const selected = await window.videoRepair.selectReference()
    if (!selected || !inputPath) return
    setReferencePath(selected)
    void runPreflight(inputPath, selected)
  }

  const start = async (experimentalRecovery = false, recoveryHints?: RecoveryHints) => {
    if (!inputPath || busy || preflighting) return
    setResult(null)
    setLogs([])
    setLogsOpen(false)
    setProgress(null)
    setStage('diagnosing')
    try {
      const nextResult = await window.videoRepair.startRepair({
        inputPath,
        referencePath: experimentalRecovery ? undefined : referencePath || undefined,
        experimentalRecovery,
        recoveryHints,
      })
      setResult(nextResult)
      setStage(nextResult.stage)
      if (!nextResult.success) setLogsOpen(true)
      await loadHistory()
    } catch (error) {
      setResult({
        success: false, stage: 'failed', skippedErrors: 0,
        reason: error instanceof Error ? error.message : '无法启动修复',
      })
      setStage('failed')
      setLogsOpen(true)
    }
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    const file = event.dataTransfer.files[0]
    if (!file) return
    const droppedPath = window.videoRepair.getDroppedFilePath(file)
    if (droppedPath) resetWithFile(droppedPath)
  }

  const buildHints = (): RecoveryHints | undefined => {
    const width = hintResolution === '720' ? 1280 : hintResolution === '1080' ? 1920 : hintResolution === '2160' ? 3840 : undefined
    const height = hintResolution === '720' ? 720 : hintResolution === '1080' ? 1080 : hintResolution === '2160' ? 2160 : undefined
    const hints: RecoveryHints = {
      codec: hintCodec || undefined,
      width,
      height,
      frameRate: hintFrameRate ? Number(hintFrameRate) as 30 | 60 : undefined,
    }
    return Object.values(hints).some((value) => value !== undefined) ? hints : undefined
  }

  const selectedWidth = hintResolution === '720' ? 1280 : hintResolution === '1080' ? 1920 : hintResolution === '2160' ? 3840 : undefined
  const hasMatchingProfile = PROFILE_COMBINATIONS.some(([codec, width, frameRate]) => (
    (!hintCodec || codec === hintCodec)
    && (!selectedWidth || width === selectedWidth)
    && (!hintFrameRate || frameRate === Number(hintFrameRate))
  ))

  const progressValue = progress?.percent ?? (stage === 'success' ? 100 : 0)
  const standardReady = Boolean(preflight?.canStart) && !preflighting && !busy
  const experimentalReady = Boolean(preflight?.diskSpace.sufficient && preflight.diagnosis.category === 'missing-index')
  const repeatExperimental = result?.success && result.method === 'experimental-index'
  const primaryReady = repeatExperimental ? experimentalReady : standardReady

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><Wrench size={19} strokeWidth={2.2} /></div>
        <div className="brand-copy"><h1>视频修复助手</h1><span>本地离线处理</span></div>
        <div className="topbar-actions">
          <div className="privacy-badge"><ShieldCheck size={15} /> 原文件保持不变</div>
          <button className="history-trigger" onClick={() => { setHistoryOpen(true); void loadHistory() }}>
            <History size={16} /><span>最近任务</span>{history.length > 0 && <b>{history.length}</b>}
          </button>
        </div>
      </header>

      <div className="workspace">
        <section className="primary-column">
          <div className="section-heading">
            <div><span className="step-number">01</span><h2>待修复视频</h2></div>
            {inputPath && !busy && <button className="icon-button" aria-label="重新选择视频" title="重新选择视频" onClick={() => resetWithFile('')}><RotateCcw size={17} /></button>}
          </div>

          {!inputPath ? (
            <button className={`drop-zone ${dragging ? 'is-dragging' : ''}`} onClick={selectInput}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
              onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
              <span className="drop-icon"><Upload size={24} /></span>
              <strong>拖入视频或点击选择</strong><small>MP4 · MOV · M4V · 3GP</small>
            </button>
          ) : (
            <div className="selected-file">
              <span className="file-icon"><FileVideo2 size={22} /></span>
              <div className="file-copy"><strong>{fileName(inputPath)}</strong><span title={inputPath}>{inputPath}</span></div>
              <div className="file-meta">
                {preflighting ? <><LoaderCircle className="spin" size={14} /> 正在预检</> : preflight ? <>{formatBytes(preflight.fileSizeBytes)}<b>预检完成</b></> : <b>预检失败</b>}
              </div>
            </div>
          )}

          {preflight && (
            <div className={`preflight-band ${preflight.canStart ? 'ready' : 'warning'}`}>
              <span className="band-icon">{preflight.canStart ? <ShieldCheck size={18} /> : <CircleAlert size={18} />}</span>
              <div><strong>{preflight.recommendedStrategy === 'index-rebuild' ? '建议重建视频索引' : preflight.recommendedStrategy === 'remux' ? '建议先进行无损修复' : '无法进行通用修复'}</strong><span>{preflight.strategyReason}</span></div>
              <span className="disk-fact"><HardDrive size={14} /> {formatBytes(preflight.diskSpace.availableBytes)} 可用</span>
            </div>
          )}

          {preflightError && <div className="inline-error"><CircleAlert size={17} /><span>{preflightError}</span></div>}

          {needsReference && (
            <div className="reference-panel">
              <div className="reference-copy"><strong>需要参考视频</strong><span>选择同设备、同分辨率和录制设置的正常视频</span></div>
              <div className="reference-actions">
                <button className={`reference-picker ${referenceInvalid ? 'invalid' : ''}`} onClick={selectReference}>
                  <FileVideo2 size={17} /><span>{referencePath ? fileName(referencePath) : '选择参考视频'}</span><ChevronRight size={16} />
                </button>
                <button className="button secondary compact" disabled={!experimentalReady} onClick={() => setExperimentalOpen(true)}>无参考恢复</button>
              </div>
              {preflight?.reference && (
                <div className={`compatibility ${preflight.reference.compatible ? 'valid' : 'invalid'}`}>
                  {preflight.reference.compatible ? <Check size={14} /> : <CircleAlert size={14} />}
                  {preflight.reference.compatible ? '参考视频参数可用' : preflight.reference.reason}
                </div>
              )}
            </div>
          )}

          <div className="section-heading repair-heading">
            <div><span className="step-number">02</span><h2>处理进度</h2></div>
            <span className={`stage-pill stage-${stage}`}>{STAGE_LABELS[stage]}</span>
          </div>

          <div className="progress-area">
            <div className={`progress-track ${busy && progress?.percent == null ? 'indeterminate' : ''}`}><span style={{ width: `${progressValue}%` }} /></div>
            <div className="progress-meta">
              <strong>{progress?.message ?? (preflighting ? '正在读取媒体结构…' : preflight?.canStart ? '预检完成，可以开始修复' : preflight ? preflight.strategyReason : inputPath ? '等待预检结果' : '请先选择视频')}</strong>
              <span>{progress?.percent != null ? `${Math.round(progress.percent)}%` : progress?.speed || ''}</span>
            </div>
            {busy && progress?.recoveryAttempt && <div className="attempt-line"><Gauge size={14} />{progress.recoveryAttempt.label}<span>{progress.recoveryAttempt.index}/{progress.recoveryAttempt.total}</span></div>}
            <div className="stage-rail" aria-label="处理阶段">
              <StageItem icon={<FileSearch size={16} />} label="预检" active={stage === 'diagnosing'} done={!['idle', 'diagnosing', 'failed'].includes(stage)} />
              <span />
              <StageItem icon={<Wrench size={16} />} label={stage === 'transcoding' ? '抢救' : '修复'} active={['remuxing', 'rebuilding-index', 'transcoding'].includes(stage)} done={['verifying', 'success'].includes(stage)} />
              <span />
              <StageItem icon={<Check size={16} />} label="验证" active={stage === 'verifying'} done={stage === 'success'} />
            </div>
            {busy && progress && <div className="runtime-meta"><Clock3 size={13} /> 已用时 {formatDuration(progress.elapsedSeconds)}{progress.speed && <span>速度 {progress.speed}</span>}</div>}
          </div>

          <div className="action-row">
            {busy ? (
              <button className="button danger" onClick={() => window.videoRepair.cancelRepair()}><Square size={15} fill="currentColor" />取消处理</button>
            ) : (
              <button className="button primary" disabled={!primaryReady} onClick={() => repeatExperimental ? setExperimentalOpen(true) : void start(false)}>
                {stage === 'failed' || stage === 'cancelled' ? <RotateCcw size={17} /> : <Wrench size={17} />}
                {repeatExperimental ? '再次实验恢复' : stage === 'success' ? '再次修复' : stage === 'failed' || stage === 'cancelled' ? '重新尝试' : needsReference ? '使用参考视频修复' : '开始修复'}
              </button>
            )}
            {(result?.logPath || logs.length > 0) && <button className="button secondary" onClick={() => window.videoRepair.exportLog(result?.logPath)}><Save size={16} />导出日志</button>}
          </div>
        </section>

        <aside className="detail-column">
          <div className="detail-header"><div><span>任务详情</span><h2>{result?.success ? '质量报告' : result?.reason ? '处理结果' : '诊断结果'}</h2></div>{summary && <button className="icon-button" aria-label="复制诊断摘要" title="复制诊断摘要" onClick={() => window.videoRepair.copyText(summary)}><Clipboard size={16} /></button>}</div>

          {result?.success && result.outputPath && result.verification ? (
            <QualityReport result={result} />
          ) : result?.reason ? (
            <div className={`failure-block ${stage === 'cancelled' ? 'cancelled' : ''}`}><CircleAlert size={20} /><div><strong>{STAGE_LABELS[stage]}</strong><span>{result.reason}</span></div></div>
          ) : diagnosis ? (
            <DiagnosisView diagnosis={diagnosis} preflight={preflight} />
          ) : (
            <div className="detail-empty"><FileSearch size={27} /><strong>{preflighting ? '正在分析视频' : '尚未选择视频'}</strong><span>{preflighting ? '诊断信息将在预检完成后显示' : '选择文件后自动执行结构与空间预检'}</span></div>
          )}

          {result?.success && result.outputPath && (
            <div className="result-actions-main">
              <button className="button primary" onClick={() => window.videoRepair.openOutput(result.outputPath!)}><Play size={16} fill="currentColor" />使用系统播放器检查</button>
              <button className="button secondary" onClick={() => window.videoRepair.openOutputFolder(result.outputPath!)}><FolderOpen size={16} />打开所在文件夹</button>
            </div>
          )}

          <section className={`log-section ${logsOpen ? 'open' : ''}`}>
            <button className="log-toggle" onClick={() => setLogsOpen((value) => !value)} aria-expanded={logsOpen}>
              <span><ChevronDown size={16} />处理日志</span><b>{logs.length} 条</b>
            </button>
            {logsOpen && <div className="log-output">{logs.length ? logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : <span>暂无处理日志</span>}{busy && <LoaderCircle className="spin" size={15} />}</div>}
            {logsOpen && logs.length > 0 && <button className="copy-log" onClick={() => window.videoRepair.copyText(logs.join('\n'))}><Clipboard size={14} />复制日志</button>}
          </section>
        </aside>
      </div>

      {historyOpen && <HistoryDrawer entries={history} loading={historyLoading} confirmClear={confirmClear}
        onClose={() => { setHistoryOpen(false); setConfirmClear(false) }}
        onClearRequest={() => setConfirmClear(true)} onClearCancel={() => setConfirmClear(false)}
        onClear={async () => { await window.videoRepair.clearRepairHistory(); setConfirmClear(false); await loadHistory() }}
        onRemove={async (id) => { await window.videoRepair.removeRepairHistoryEntry(id); await loadHistory() }} />}

      {experimentalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExperimentalOpen(false) }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="experimental-title">
            <div className="modal-header"><div><span>实验功能</span><h2 id="experimental-title">无参考参数恢复</h2></div><button className="icon-button" aria-label="关闭" title="关闭" onClick={() => setExperimentalOpen(false)}><X size={18} /></button></div>
            <p>提供已知录像参数可减少尝试次数；不确定的项目保持“自动”。</p>
            <div className="field-grid">
              <label><span>视频编码</span><select value={hintCodec} onChange={(event) => setHintCodec(event.target.value as typeof hintCodec)}><option value="">自动</option><option value="h264">H.264</option><option value="hevc">H.265 / HEVC</option></select></label>
              <label><span>分辨率</span><select value={hintResolution} onChange={(event) => setHintResolution(event.target.value as typeof hintResolution)}><option value="">自动</option><option value="720">720p</option><option value="1080">1080p</option><option value="2160">4K</option></select></label>
              <label><span>帧率</span><select value={hintFrameRate} onChange={(event) => setHintFrameRate(event.target.value as typeof hintFrameRate)}><option value="">自动</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label>
            </div>
            {!hasMatchingProfile && <div className="inline-error"><CircleAlert size={16} /><span>当前组合没有内置参数，请放宽一个筛选条件。</span></div>}
            <div className="modal-actions"><button className="button secondary" onClick={() => setExperimentalOpen(false)}>取消</button><button className="button primary" disabled={!hasMatchingProfile} onClick={() => { setExperimentalOpen(false); void start(true, buildHints()) }}>开始实验恢复</button></div>
          </section>
        </div>
      )}
    </main>
  )
}

function DiagnosisView({ diagnosis, preflight }: { diagnosis: Diagnosis; preflight: RepairPreflight | null }) {
  return <div className="diagnosis-content">
    <div className={`diagnosis-banner ${diagnosis.needsReference || diagnosis.category === 'no-media' ? 'warning' : ''}`}>{diagnosis.needsReference || diagnosis.category === 'no-media' ? <CircleAlert size={18} /> : <ShieldCheck size={18} />}<div><strong>{diagnosis.summary}</strong><span>{preflight?.strategyReason}</span></div></div>
    <dl className="facts">
      <div><dt>容器</dt><dd>{diagnosis.format}</dd></div>
      <div><dt>时长</dt><dd>{formatDuration(diagnosis.durationSeconds)}</dd></div>
      {preflight && <div><dt>文件</dt><dd>{formatBytes(preflight.fileSizeBytes)}</dd></div>}
      {diagnosis.streams.map((stream) => {
        const frameRate = stream.type === 'video' ? formatFrameRate(stream.frameRate) : ''
        return <div key={stream.index}><dt>{stream.type === 'video' ? '视频' : stream.type === 'audio' ? '音频' : '轨道'}</dt><dd>{stream.codec}{stream.width ? ` · ${stream.width}×${stream.height}` : ''}{frameRate ? ` · ${frameRate} fps` : ''}</dd></div>
      })}
      {preflight && <div><dt>空间</dt><dd className={preflight.diskSpace.sufficient ? 'positive' : 'negative'}>{formatBytes(preflight.diskSpace.availableBytes)} 可用 · 需要 {formatBytes(preflight.diskSpace.requiredBytes)}</dd></div>}
    </dl>
  </div>
}

function QualityReport({ result }: { result: RepairResult }) {
  const verification = result.verification!
  return <div className="quality-report">
    <div className={`quality-status ${verification.status}`}><span>{verification.status === 'passed' ? <Check size={20} /> : <CircleAlert size={20} />}</span><div><strong>{verification.status === 'passed' ? '自动验证通过' : '验证通过，建议重点检查'}</strong><small>{result.method ? METHOD_LABELS[result.method] : '视频修复'}</small></div></div>
    <dl className="quality-grid">
      <div><dt>输出时长</dt><dd>{formatDuration(verification.durationSeconds)}</dd></div>
      <div><dt>输出大小</dt><dd>{formatBytes(verification.outputSizeBytes)}</dd></div>
      <div><dt>可解码帧</dt><dd>{verification.decodedFrames.toLocaleString('zh-CN')}{verification.expectedFrames ? ` / ${verification.expectedFrames.toLocaleString('zh-CN')}` : ''}</dd></div>
      <div><dt>输出可解码程度</dt><dd>{formatPercent(verification.decodeRatio)}</dd></div>
      <div><dt>跳过错误</dt><dd>{verification.errorCount} 处</dd></div>
      <div><dt>原时长保留</dt><dd>{formatPercent(verification.durationRetentionRatio)}</dd></div>
    </dl>
    {verification.warnings.length > 0 && <div className="warning-list">{verification.warnings.map((warning) => <div key={warning}><CircleAlert size={14} /><span>{warning}</span></div>)}</div>}
    <div className="quality-note">“输出可解码程度”只表示生成文件的解码情况，不代表原视频内容已完整恢复。</div>
  </div>
}

function HistoryDrawer({ entries, loading, confirmClear, onClose, onClearRequest, onClearCancel, onClear, onRemove }: {
  entries: RepairHistoryEntry[]; loading: boolean; confirmClear: boolean; onClose(): void; onClearRequest(): void;
  onClearCancel(): void; onClear(): Promise<void>; onRemove(id: string): Promise<void>
}) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div className="drawer-header"><div><span>本机记录</span><h2 id="history-title">最近任务</h2></div><button className="icon-button" aria-label="关闭历史" title="关闭" onClick={onClose}><X size={18} /></button></div>
      <div className="drawer-toolbar">
        <span>{entries.length} 条记录</span>
        {entries.length > 0 && (confirmClear ? <div className="clear-confirm"><button onClick={onClearCancel}>取消</button><button className="danger-text" onClick={() => void onClear()}>确认清空</button></div> : <button className="text-button danger-text" onClick={onClearRequest}><Trash2 size={14} />清空历史</button>)}
      </div>
      <div className="history-list">
        {loading ? <div className="drawer-empty"><LoaderCircle className="spin" size={22} />正在读取</div> : entries.length ? entries.map((entry) => (
          <article className="history-row" key={entry.id}>
            <span className={`history-status ${entry.success ? entry.verification?.status === 'warning' ? 'warning' : 'success' : 'failed'}`}>{entry.success ? entry.verification?.status === 'warning' ? <CircleAlert size={16} /> : <Check size={16} /> : <X size={16} />}</span>
            <div className="history-copy"><strong title={entry.inputPath}>{fileName(entry.inputPath)}</strong><span>{formatDate(entry.finishedAt)} · {entry.method ? METHOD_LABELS[entry.method] : STAGE_LABELS[entry.stage]}</span>{entry.reason && <small>{entry.reason}</small>}</div>
            <div className="history-actions">{entry.outputPath && <><button className="icon-button bordered" aria-label={`播放 ${fileName(entry.inputPath)}`} title="播放结果" onClick={() => window.videoRepair.openOutput(entry.outputPath!)}><Play size={14} /></button><button className="icon-button bordered" aria-label={`打开 ${fileName(entry.inputPath)} 所在文件夹`} title="打开所在文件夹" onClick={() => window.videoRepair.openOutputFolder(entry.outputPath!)}><FolderOpen size={14} /></button></>}<button className="icon-button" aria-label={`删除 ${fileName(entry.inputPath)} 的历史记录`} title="删除记录" onClick={() => void onRemove(entry.id)}><Trash2 size={14} /></button></div>
          </article>
        )) : <div className="drawer-empty"><History size={25} /><strong>暂无修复记录</strong><span>完成或失败的任务会保存在本机</span></div>}
      </div>
    </aside>
  </div>
}

function StageItem({ icon, label, active, done }: { icon: React.ReactNode; label: string; active: boolean; done: boolean }) {
  return <div className={`stage-item ${active ? 'active' : ''} ${done ? 'done' : ''}`}><i>{done ? <Check size={15} /> : icon}</i><span>{label}</span></div>
}
