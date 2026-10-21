import { Component, StrictMode, Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Circle, LayoutGrid, Settings2 } from 'lucide-react'
import './styles.css'

for (const ev of ['dragover', 'drop'] as const) window.addEventListener(ev, (e) => e.preventDefault())

const routes = {
  home: lazy(() => import('./routes/Home')),
  toolbar: lazy(() => import('./routes/Toolbar')),
  overlay: lazy(() => import('./routes/Overlay')),
  controls: lazy(() => import('./routes/Controls')),
  camera: lazy(() => import('./routes/CameraPreview')),
  editor: lazy(() => import('./editor/Editor')),
  settings: lazy(() => import('./routes/Settings')),
  notes: lazy(() => import('./routes/Notes')),
  welcome: lazy(() => import('./routes/Welcome')),
}
type RouteName = keyof typeof routes

/** Pages that live inside the main window and share the rail. */
const MAIN_PAGES: RouteName[] = ['home', 'editor', 'settings', 'welcome']
/** Floating capture UI sits over other apps and uses the light pill scheme. */
const LIGHT: RouteName[] = ['toolbar', 'overlay', 'controls']

/** Keeps a crash in one view from blanking the whole window. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="h-full app-surface flex items-center justify-center p-10 text-center">
        <div className="max-w-[460px]">
          <h1 className="text-[16px] font-semibold">Something went wrong in this window</h1>
          <p className="text-muted mt-1.5 text-[13px] break-words">{this.state.error.message}</p>
          <button className="mt-4 h-9 px-4 rounded-full bg-fg text-on-fg text-[13px] font-semibold" onClick={() => location.reload()}>
            Reload window
          </button>
        </div>
      </div>
    )
  }
}

/** The main window navigates by hash; the main process asks for pages over `navigate`. */
function useHash() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    const off = window.bridge.on('navigate', ({ route, query }) => {
      const q = new URLSearchParams(query).toString()
      window.location.hash = `/${route}${q ? '?' + q : ''}`
    })
    return () => {
      window.removeEventListener('hashchange', onChange)
      off()
    }
  }, [])
  return hash
}

export const navigate = (route: RouteName, query: Record<string, string> = {}) => {
  const q = new URLSearchParams(query).toString()
  window.location.hash = `/${route}${q ? '?' + q : ''}`
}

function Rail({ current }: { current: RouteName }) {
  const items: { id: RouteName; label: string; icon: ReactNode; go: () => void }[] = [
    { id: 'home', label: 'Library', icon: <LayoutGrid className="size-[19px]" />, go: () => navigate('home') },
    { id: 'settings', label: 'Settings', icon: <Settings2 className="size-[19px]" />, go: () => navigate('settings') },
  ]
  return (
    <nav aria-label="Main" className="drag w-[76px] shrink-0 h-full flex flex-col items-center pt-[52px] pb-4 gap-1.5 border-r border-line-soft bg-panel">
      <button
        onClick={() => window.bridge.api.openToolbar()}
        aria-label="New recording"
        title="New recording"
        className="no-drag size-10 rounded-full inline-flex items-center justify-center text-white bg-[linear-gradient(180deg,#ff5f52,#e8392e)] shadow-[inset_0_1px_0_#ffffff40,0_8px_20px_-8px_#ff3b30cc] hover:brightness-110 active:scale-95 transition-transform mb-2"
      >
        <Circle className="size-3 fill-white stroke-none" />
      </button>
      {items.map((it) => {
        const active = current === it.id || (it.id === 'home' && current === 'editor')
        return (
          <button
            key={it.id}
            onClick={it.go}
            aria-label={it.label}
            aria-current={active ? 'page' : undefined}
            title={it.label}
            className={
              'no-drag size-10 rounded-full inline-flex items-center justify-center transition-colors ' +
              (active ? 'bg-fg text-on-fg shadow-[0_8px_18px_-10px_rgba(0,0,0,0.9)]' : 'text-muted hover:text-fg hover:bg-fg/8')
            }
          >
            {it.icon}
          </button>
        )
      })}
    </nav>
  )
}

function App() {
  const hash = useHash()
  const path = hash.replace(/^#\/?/, '')
  const name = (path.split('?')[0] || 'home') as RouteName
  const Route = routes[name] ?? routes.home
  const page = (
    <ErrorBoundary key={hash}>
      <Suspense fallback={null}>
        <Route />
      </Suspense>
    </ErrorBoundary>
  )
  if (MAIN_PAGES.includes(name)) {
    return (
      <div className="h-full flex app-surface">
        {name !== 'welcome' && <Rail current={name} />}
        <div className="flex-1 min-w-0 h-full">{page}</div>
      </div>
    )
  }
  return <div className={LIGHT.includes(name) ? 'scheme-light h-full' : 'h-full'}>{page}</div>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
