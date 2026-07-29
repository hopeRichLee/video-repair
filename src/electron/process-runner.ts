import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

export class ProcessRunner {
  private child: ChildProcessWithoutNullStreams | null = null
  private cancelled = false

  isCancelled(): boolean {
    return this.cancelled
  }

  reset(): void {
    this.cancelled = false
  }

  async run(
    executable: string,
    args: string[],
    options: { cwd?: string; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void } = {},
  ): Promise<ProcessResult> {
    if (this.cancelled) throw new Error('TASK_CANCELLED')

    return await new Promise<ProcessResult>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const child = spawn(executable, args, {
        cwd: options.cwd,
        windowsHide: true,
        shell: false,
      })
      this.child = child

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString('utf8')
        stdout += chunk
        options.onStdout?.(chunk)
      })
      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString('utf8')
        stderr += chunk
        options.onStderr?.(chunk)
      })
      child.once('error', (error) => {
        this.child = null
        reject(error)
      })
      child.once('close', (code) => {
        this.child = null
        if (this.cancelled) reject(new Error('TASK_CANCELLED'))
        else resolve({ code: code ?? -1, stdout, stderr })
      })
    })
  }

  async cancel(): Promise<boolean> {
    this.cancelled = true
    if (!this.child?.pid) return false
    const pid = this.child.pid
    if (process.platform === 'win32') {
      spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false })
    } else {
      this.child.kill('SIGTERM')
    }
    return true
  }
}
