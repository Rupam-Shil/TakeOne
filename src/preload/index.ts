import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_METHODS, type Api, type Bridge } from '@shared/ipc'

// contextBridge can't clone a Proxy, so expose a plain object of invoke wrappers.
const api = Object.fromEntries(API_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(m, ...args)])) as unknown as Api

const bridge: Bridge = {
  api,
  on(channel, cb) {
    const listener = (_e: Electron.IpcRendererEvent, payload: any) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('bridge', bridge)
