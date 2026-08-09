import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { App, BrandMark } from './App'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Renderer failed', error, info.componentStack)
  }

  render() {
    if (this.state.failed) return <FatalState message="界面加载失败，请重新启动应用。" />
    return this.props.children
  }
}

function FatalState({ message }: { message: string }) {
  return <main className="fatal-state"><BrandMark /><h1>视频修复助手无法启动</h1><p>{message}</p></main>
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(window.videoRepair ? (
  <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>
) : <FatalState message="本地处理组件未能加载，请重新安装或重启应用。" />)
