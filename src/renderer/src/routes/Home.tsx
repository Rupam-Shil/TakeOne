import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Clapperboard, Copy, FileVideo, FolderOpen, Import, MoreHorizontal, Pencil, Play, Plus, Search, Trash2, Video } from 'lucide-react'
import type { ProjectSummary } from '@shared/project-file'
import type { ExportedFile } from '@shared/ipc'
import { mediaUrl } from '@shared/media'
import { api, bridge, formatTime, useSettings } from '@/lib/bridge'
import { formatShortcut } from '@/lib/shortcuts'
import { Kbd, MenuItem, Popover, Segmented, cx } from '@/ui/controls'

type View = 'projects' | 'exports'

const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

function groupLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 864e5).toDateString()
  if (d.toDateString() === today) return 'Today'
  if (d.toDateString() === yesterday) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** The library: a sidebar that filters, and a content area with the projects and the exported files. */
export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [exports, setExports] = useState<ExportedFile[]>([])
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>('projects')
  const [group, setGroup] = useState<string>('all')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [settings] = useSettings()

  const refresh = useCallback(() => {
    api.listProjects().then(setProjects)
    api.listExports().then(setExports).catch(() => setExports([]))
  }, [])
  useEffect(() => {
    refresh()
    const off = bridge.on('projects:changed', () => refresh())
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const groups = useMemo(() => {
    const out = new Map<string, number>()
    for (const p of projects ?? []) out.set(groupLabel(p.createdAt), (out.get(groupLabel(p.createdAt)) ?? 0) + 1)
    return [...out.entries()]
  }, [projects])

  const shown = useMemo(
    () => (projects ?? []).filter((p) => (group === 'all' || groupLabel(p.createdAt) === group) && p.name.toLowerCase().includes(query.toLowerCase())),
    [projects, group, query],
  )
  const shownExports = useMemo(() => exports.filter((e) => e.name.toLowerCase().includes(query.toLowerCase())), [exports, query])
  const shortcut = formatShortcut(settings?.shortcuts.startStopRecording ?? '')

  return (
    <div className="h-full flex">
      <aside className="w-[292px] shrink-0 h-full flex flex-col border-r border-line-soft bg-panel">
        <header className="drag h-[52px] shrink-0 flex items-center justify-between pl-5 pr-3">
          <h1 className="text-[17px] font-bold">Library</h1>
          <div className="no-drag flex items-center gap-1">
            <button onClick={() => api.importVideo()} aria-label="Import a video" title="Import a video…" className="size-8 rounded-full inline-flex items-center justify-center text-muted hover:text-fg hover:bg-fg/8">
              <Import className="size-4" />
            </button>
            <button onClick={() => api.openToolbar()} aria-label="New recording" title="New recording" className="size-8 rounded-full inline-flex items-center justify-center text-muted hover:text-fg hover:bg-fg/8">
              <Plus className="size-[18px]" />
            </button>
          </div>
        </header>
        <div className="px-4 pb-3 flex flex-col gap-3">
          <label className="relative block">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search"
              className="w-full h-10 pl-10 pr-4 rounded-full bg-control text-[13.5px] font-medium outline-none placeholder:text-faint focus:shadow-[0_0_0_2px_var(--color-fg)]"
            />
          </label>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'projects', label: 'Projects' },
              { value: 'exports', label: 'Exports' },
            ]}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-0.5">
          {view === 'projects' ? (
            <>
              <SideRow active={group === 'all'} onClick={() => setGroup('all')} icon={<Clapperboard className="size-4" />} label="All projects" count={projects?.length ?? 0} />
              {groups.map(([label, n]) => (
                <SideRow key={label} nested active={group === label} onClick={() => setGroup(label)} icon={<Video className="size-4" />} label={label} count={n} />
              ))}
            </>
          ) : (
            <>
              <SideRow active icon={<FileVideo className="size-4" />} label="Exported files" count={exports.length} onClick={() => api.revealInFinder(settings?.general.exportDir ?? '')} />
              <p className="px-3 pt-2 text-[12px] text-faint font-medium leading-snug">Saved to {settings?.general.exportDir}</p>
            </>
          )}
        </div>
        <div className="px-4 pb-4 pt-2 border-t border-line-soft">
          <button
            onClick={() => api.openToolbar()}
            className="w-full h-11 rounded-full text-white text-[14px] font-bold inline-flex items-center justify-center gap-2.5 bg-[linear-gradient(180deg,#ff5f52,#e8392e)] shadow-[inset_0_1px_0_#ffffff40,0_12px_28px_-12px_#ff3b30cc] hover:brightness-110 active:scale-[0.98] transition-transform"
          >
            <span className="size-2.5 rounded-full bg-white" /> New recording
          </button>
          {shortcut && (
            <p className="mt-2.5 text-center text-[12px] text-faint font-medium inline-flex w-full items-center justify-center gap-1.5">
              or press <Kbd>{shortcut}</Kbd> anywhere
            </p>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 h-full flex flex-col">
        <header className="drag h-[52px] shrink-0 flex items-center px-8 gap-2">
          <h2 className="text-[15px] font-semibold inline-flex items-center gap-1.5">
            {view === 'projects' ? (group === 'all' ? 'All projects' : group) : 'Exports'}
            <ChevronDown className="size-4 text-faint" />
          </h2>
          <span className="text-[13px] text-faint font-medium tabular">{view === 'projects' ? `${shown.length}` : `${shownExports.length}`}</span>
        </header>
        <div className="flex-1 overflow-y-auto px-8 pb-10">
          {view === 'projects' ? (
            <>
              <h3 className="text-[22px] font-bold mb-4">Projects</h3>
              {projects && projects.length === 0 && <EmptyState shortcut={shortcut} />}
              {projects && projects.length > 0 && shown.length === 0 && <p className="text-muted text-[13px] py-10">No projects match “{query}”.</p>}
              <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(236px, 1fr))' }}>
                {shown.map((p) => (
                  <ProjectCard
                    key={p.path}
                    project={p}
                    renaming={renaming === p.path}
                    onRename={() => setRenaming(p.path)}
                    onRenamed={async (name) => {
                      setRenaming(null)
                      if (name && name !== p.name) await api.renameProject(p.path, name)
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <h3 className="text-[22px] font-bold mb-4">Exports</h3>
              <ExportsTable files={shownExports} />
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function SideRow({ active, onClick, icon, label, count, nested }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number; nested?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'h-10 rounded-full flex items-center gap-2.5 pr-2.5 text-[13.5px] font-semibold transition-colors',
        nested ? 'pl-7' : 'pl-3',
        active ? 'bg-raised text-fg shadow-[0_8px_18px_-12px_rgba(0,0,0,0.9)]' : 'text-muted hover:text-fg hover:bg-fg/5',
      )}
    >
      <span className={active ? 'text-fg' : 'text-faint'}>{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      <span className={cx('min-w-7 h-6 px-2 rounded-full inline-flex items-center justify-center text-[11.5px] tabular', active ? 'bg-fg text-on-fg' : 'bg-control text-muted')}>{count}</span>
    </button>
  )
}

function EmptyState({ shortcut }: { shortcut: string }) {
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-3 max-w-[560px]">
      <div className="size-14 rounded-full bg-control flex items-center justify-center">
        <Video className="size-6 text-muted" />
      </div>
      <h4 className="text-[18px] font-bold">Nothing recorded yet</h4>
      <p className="text-muted text-[13.5px] font-medium max-w-[360px]">Record a display, window or area. Zooms, a smooth cursor and a background are added for you.</p>
      {shortcut && (
        <p className="text-[12.5px] text-faint font-medium inline-flex items-center gap-1.5">
          Press <Kbd>{shortcut}</Kbd> anywhere to start.
        </p>
      )}
    </div>
  )
}

function ExportsTable({ files }: { files: ExportedFile[] }) {
  if (!files.length) return <p className="text-muted text-[13px] py-6">Nothing exported yet. Videos you export to a file show up here.</p>
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1fr_180px_90px_150px_44px] px-5 h-11 items-center text-[12px] font-semibold text-muted border-b border-line-soft">
        <span>Name</span>
        <span>Project</span>
        <span>Size</span>
        <span>Exported</span>
        <span />
      </div>
      {files.map((f) => (
        <div key={f.path} className="grid grid-cols-[1fr_180px_90px_150px_44px] px-5 h-12 items-center text-[13.5px] font-medium border-b border-line-soft last:border-b-0 hover:bg-fg/4">
          <button className="flex items-center gap-3 min-w-0 text-left" onClick={() => api.openPath(f.path)} title="Open">
            <span className="size-8 rounded-[10px] bg-control inline-flex items-center justify-center text-muted shrink-0">
              <Play className="size-3.5 fill-current" />
            </span>
            <span className="truncate">{f.name}</span>
          </button>
          <span className="text-muted truncate pr-3">{f.project}</span>
          <span className="text-muted tabular">{fmtBytes(f.size)}</span>
          <span className="text-muted tabular">{new Date(f.modifiedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          <button onClick={() => api.revealInFinder(f.path)} aria-label="Show in Finder" title="Show in Finder" className="size-8 rounded-full inline-flex items-center justify-center text-muted hover:text-fg hover:bg-fg/8">
            <FolderOpen className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

function ProjectCard({
  project,
  renaming,
  onRename,
  onRenamed,
}: {
  project: ProjectSummary
  renaming: boolean
  onRename: () => void
  onRenamed: (name: string) => void
}) {
  const open = () => api.openEditor(project.path)
  return (
    <div className="group relative card p-2.5 flex flex-col gap-2 transition-shadow duration-150 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_18px_40px_-18px_rgba(0,0,0,0.8),0_1px_2px_rgba(0,0,0,0.3)] has-[[data-popover]]:z-30">
      <button onDoubleClick={open} onClick={open} aria-label={`Open ${project.name}`} className="relative aspect-[16/10] rounded-[14px] overflow-hidden bg-control">
        {project.thumbnail ? (
          <img src={mediaUrl(project.thumbnail) + `?v=${encodeURIComponent(project.updatedAt)}`} className="absolute inset-0 size-full object-cover" alt="" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-faint">
            <Video className="size-6" />
          </div>
        )}
        {project.duration > 0 && (
          <span className="absolute right-2 bottom-2 h-6 px-2 rounded-full bg-black/75 text-white text-[11.5px] font-semibold tabular flex items-center">{formatTime(project.duration)}</span>
        )}
      </button>
      <div className="flex items-start gap-1 min-w-0 px-1.5 pb-0.5">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              defaultValue={project.name}
              aria-label="Project name"
              onBlur={(e) => onRenamed(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenamed((e.target as HTMLInputElement).value)
                if (e.key === 'Escape') onRenamed(project.name)
              }}
              className="w-full h-7 px-2 -mx-2 rounded-full bg-control outline-none text-[13.5px] font-semibold"
            />
          ) : (
            <div className="text-[13.5px] font-semibold truncate" onDoubleClick={onRename}>
              {project.name}
            </div>
          )}
          <div className="text-[12px] text-faint font-medium">
            {new Date(project.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {new Date(project.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </div>
        </div>
        <Popover
          align="end"
          trigger={(_, toggle) => (
            <button onClick={toggle} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 size-7 rounded-full inline-flex items-center justify-center text-muted hover:text-fg hover:bg-fg/8" aria-label="Project actions">
              <MoreHorizontal className="size-4" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem onClick={() => (close(), onRename())}>
                <Pencil className="size-3.5" /> Rename
              </MenuItem>
              <MenuItem onClick={() => (close(), api.duplicateProject(project.path))}>
                <Copy className="size-3.5" /> Duplicate
              </MenuItem>
              <MenuItem onClick={() => (close(), api.revealInFinder(project.path))}>
                <FolderOpen className="size-3.5" /> Show in Finder
              </MenuItem>
              <div className="h-px bg-line-soft my-1" />
              <MenuItem danger onClick={() => (close(), api.trashProject(project.path))}>
                <Trash2 className="size-3.5" /> Move to Trash
              </MenuItem>
            </>
          )}
        </Popover>
      </div>
    </div>
  )
}
