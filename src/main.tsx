import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { setupSafeArea } from './app/safeArea.js'
import { setupFontScale } from './app/fontScale.js'
import { ensureKatex } from './services/markdown/katex.js'
import { installDiagnostics } from './services/diagnostics/log.js'
import './app/theme.css'
import './app/global.css'

// 尽早挂上日志采集（console / 全局异常 / fetch），设置里可导出
installDiagnostics()
ensureKatex()
setupTheme()
setupSafeArea()
setupFontScale()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
