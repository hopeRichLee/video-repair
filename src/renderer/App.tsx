import { useEffect, useMemo, useState } from 'react'
import {
  Check, ChevronRight, CircleAlert, Clipboard, FileSearch, FileVideo2, FolderOpen,
  FlaskConical, LoaderCircle, Play, RotateCcw, Save, ShieldCheck, Square, Upload, Wrench,
} from 'lucide-react'
import type { Diagnosis, RepairProgress, RepairResult, RepairStage } from '../shared/types'

const BUSY_STAGES: RepairStage[] = ['diagnosing', 'rebuilding-index', 'remuxing', 'transcoding', 'verifying']

const STAGE_LABELS: Record<RepairStage, string> = {
  idle: '等待文件',
  diagnosing: '诊断中',
  'needs-reference': '需要参考视频',
  'rebuilding-index': '重建索引',
  remuxing: '无损修复',
  transcoding: '深度抢救',
  verifying: '验证结果',
  success: '修复完成',
  failed: '修复失败',
  cancelled: '已取消',
}

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
  const [stage, setStage] = useState<RepairStage>('idle')
  const [progress, setProgress] = useState<RepairProgress | null>(null)
  const [result, setResult] = useState<RepairResult | null>(null)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | undefined>()
  const [logs, setLogs] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)

  const busy = BUSY_STAGES.includes(stage)
  const needsReference = stage === 'needs-reference'
  const showReference = Boolean(diagnosis?.needsReference) && !busy && stage !== 'success'
  const summary = useMemo(() => diagnosisText(diagnosis), [diagnosis])

  useEffect(() => {
    window.videoRepair.onProgress((next) => {
      setProgress(next)
      setStage(next.stage)
      if (next.diagnosis) setDiagnosis(next.diagnosis)
      if (next.logLine) setLogs((current) => [...current.slice(-199), next.logLine!])
    })
    return () => window.videoRepair.removeProgressListeners()
  }, [])

  const selectInput = async () => {
    const selected = await window.videoRepair.selectInput()
    if (selected) resetWithFile(selected)
  }

  const resetWithFile = (selected: string) => {
    setInputPath(selected)
    setReferencePath('')
    setStage('idle')
    setProgress(null)
    setResult(null)
    setDiagnosis(undefined)
    setLogs([])
  }

  const selectReference = async () => {
    const selected = await window.videoRepair.selectReference()
    if (selected) setReferencePath(selected)
  }

  const start = async (experimentalRecovery = false) => {
    if (!inputPath || busy) return
    setResult(null)
    if (!needsReference) {
      setDiagnosis(undefined)
      setLogs([])
    }
    try {
      const nextResult = await window.videoRepair.startRepair({
        inputPath,
        referencePath: experimentalRecovery ? undefined : referencePath || undefined,
        experimentalRecovery,
      })
      setResult(nextResult)
      setStage(nextResult.stage)
      if (nextResult.diagnosis) setDiagnosis(nextResult.diagnosis)
    } catch (error) {
      setResult({ success: false, stage: 'failed', skippedErrors: 0, reason: error instanceof Error ? error.message : '无法启动修复' })
      setStage('failed')
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

  const methodLabel = result?.method === 'remux'
    ? '无损重封装'
    : result?.method === 'index-rebuild'
      ? '参考索引重建'
      : result?.method === 'experimental-index'
        ? '无参考实验恢复'
        : '容错转码'
  const progressValue = progress?.percent ?? (stage === 'success' ? 100 : 0)

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><Wrench size={19} strokeWidth={2.2} /></div>
        <div className="brand-copy">
          <h1>视频修复助手</h1>
          <span>本地离线处理</span>
        </div>
        <div className="privacy-badge"><ShieldCheck size={16} /> 原文件保持不变</div>
      </header>

      <div className="workspace">
        <section className="primary-column">
          <div className="section-heading">
            <div><span className="step-number">01</span><h2>损坏的视频</h2></div>
            {inputPath && !busy && <button className="icon-button" title="重新选择" onClick={() => resetWithFile('')}><RotateCcw size={17} /></button>}
          </div>

          {!inputPath ? (
            <button
              className={`drop-zone ${dragging ? 'is-dragging' : ''}`}
              onClick={selectInput}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="drop-icon"><Upload size={25} /></span>
              <strong>拖入视频或点击选择</strong>
              <small>MP4 · MOV · M4V · 3GP</small>
            </button>
          ) : (
            <div className="selected-file">
              <span className="file-icon"><FileVideo2 size={23} /></span>
              <div className="file-copy">
                <strong>{fileName(inputPath)}</strong>
                <span title={inputPath}>{inputPath}</span>
              </div>
              <span className="file-status">已选择</span>
            </div>
          )}

          {showReference && (
            <div className="reference-panel">
              <div className="reference-alert"><CircleAlert size={18} /><span>视频索引缺失</span></div>
              <div className="reference-actions">
                <button className="reference-picker" onClick={selectReference}>
                  <FileVideo2 size={18} />
                  <span>{referencePath ? fileName(referencePath) : '选择同设备的正常视频'}</span>
                  <ChevronRight size={17} />
                </button>
                <button className="experimental-button" title="尝试 iPhone 6 常见录像参数" onClick={() => start(true)}>
                  <FlaskConical size={17} />
                  <span>无参考实验恢复</span>
                </button>
              </div>
            </div>
          )}

          <div className="section-heading repair-heading">
            <div><span className="step-number">02</span><h2>修复进度</h2></div>
            <span className={`stage-pill stage-${stage}`}>{STAGE_LABELS[stage]}</span>
          </div>

          <div className="progress-area">
            <div className="progress-track"><span style={{ width: `${progressValue}%` }} /></div>
            <div className="progress-meta">
              <strong>{progress?.message ?? (inputPath ? '准备开始修复' : '请先选择视频')}</strong>
              <span>{progress?.percent != null ? `${Math.round(progress.percent)}%` : progress?.speed || ''}</span>
            </div>
            <div className="stage-rail" aria-label="修复阶段">
              <StageItem icon={<FileSearch size={17} />} label="诊断" active={stage === 'diagnosing'} done={!['idle', 'diagnosing'].includes(stage)} />
              <span />
              <StageItem icon={<Wrench size={17} />} label={stage === 'transcoding' ? '抢救' : '修复'} active={['remuxing', 'rebuilding-index', 'transcoding'].includes(stage)} done={['verifying', 'success'].includes(stage)} />
              <span />
              <StageItem icon={<Check size={17} />} label="验证" active={stage === 'verifying'} done={stage === 'success'} />
            </div>
          </div>

          <div className="action-row">
            {busy ? (
              <button className="button danger" onClick={() => window.videoRepair.cancelRepair()}><Square size={16} fill="currentColor" />取消修复</button>
            ) : (
              <button className="button primary" disabled={!inputPath || (showReference && !referencePath)} onClick={() => start(false)}>
                {stage === 'failed' || stage === 'cancelled' ? <RotateCcw size={18} /> : <Wrench size={18} />}
                {showReference ? (stage === 'failed' ? '更换参考视频后重试' : '使用参考视频继续') : stage === 'failed' || stage === 'cancelled' ? '重新尝试' : '开始修复'}
              </button>
            )}
            {(result?.logPath || logs.length > 0) && <button className="button secondary" onClick={() => window.videoRepair.exportLog(result?.logPath)}><Save size={17} />导出日志</button>}
          </div>
        </section>

        <aside className="detail-column">
          <section className="detail-section diagnosis-section">
            <div className="detail-title"><h2>诊断结果</h2>{summary && <button className="icon-button" title="复制诊断摘要" onClick={() => window.videoRepair.copyText(summary)}><Clipboard size={16} /></button>}</div>
            {!diagnosis ? (
              <div className="empty-state"><FileSearch size={27} /><span>尚未诊断</span></div>
            ) : (
              <div className="diagnosis-content">
                <div className={`diagnosis-banner ${diagnosis.needsReference ? 'warning' : ''}`}>
                  {diagnosis.needsReference ? <CircleAlert size={18} /> : <ShieldCheck size={18} />}
                  <strong>{diagnosis.summary}</strong>
                </div>
                <dl className="facts">
                  <div><dt>容器</dt><dd>{diagnosis.format}</dd></div>
                  <div><dt>时长</dt><dd>{formatDuration(diagnosis.durationSeconds)}</dd></div>
                  {diagnosis.streams.map((stream) => (
                    <div key={stream.index}>
                      <dt>{stream.type === 'video' ? '视频' : stream.type === 'audio' ? '音频' : '轨道'}</dt>
                      <dd>{stream.codec}{stream.width ? ` · ${stream.width}×${stream.height}` : ''}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>

          {result?.success && result.outputPath ? (
            <section className="result-section">
              <div className="success-icon"><Check size={22} /></div>
              <div className="result-copy"><span>{result.warnings?.[0] ?? `${methodLabel}${result.skippedErrors > 0 ? ` · 跳过 ${result.skippedErrors} 处损坏` : ''}`}</span><strong>{fileName(result.outputPath)}</strong></div>
              <div className="result-actions">
                <button className="button primary compact" onClick={() => window.videoRepair.openOutput(result.outputPath!)}><Play size={16} fill="currentColor" />播放</button>
                <button className="icon-button bordered" title="打开所在文件夹" onClick={() => window.videoRepair.openOutputFolder(result.outputPath!)}><FolderOpen size={17} /></button>
              </div>
            </section>
          ) : result?.reason && stage !== 'needs-reference' ? (
            <section className="failure-section"><CircleAlert size={19} /><div><strong>{STAGE_LABELS[stage]}</strong><span>{result.reason}</span></div></section>
          ) : null}

          <section className="detail-section log-section">
            <div className="detail-title"><h2>处理日志</h2><span>{logs.length} 条</span></div>
            <div className="log-output">
              {logs.length ? logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : <span>开始后将在这里显示关键记录</span>}
              {busy && <LoaderCircle className="spin" size={15} />}
            </div>
          </section>
        </aside>
      </div>
    </main>
  )
}

function StageItem({ icon, label, active, done }: { icon: React.ReactNode; label: string; active: boolean; done: boolean }) {
  return <div className={`stage-item ${active ? 'active' : ''} ${done ? 'done' : ''}`}><i>{done ? <Check size={16} /> : icon}</i><span>{label}</span></div>
}
