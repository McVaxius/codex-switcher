import { contextBridge, ipcRenderer } from "electron";

type WindowStateListener = (state: { isMaximized: boolean }) => void;

contextBridge.exposeInMainWorld("codexSwitcher", {
  invoke: <T>(command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("codex:invoke", command, args) as Promise<T>,
  openExternalUrl: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  pickAuthJsonFile: () => ipcRenderer.invoke("dialog:pickAuthJson") as Promise<string | null>,
  saveFullBackupFile: () =>
    ipcRenderer.invoke("dialog:saveFullBackup") as Promise<string | null>,
  pickFullBackupFile: () =>
    ipcRenderer.invoke("dialog:pickFullBackup") as Promise<string | null>,
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
  onWindowStateChanged: (listener: WindowStateListener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { isMaximized: boolean }) => {
      listener(state);
    };
    ipcRenderer.on("window:state", handler);
    return () => ipcRenderer.removeListener("window:state", handler);
  },
  checkForUpdate: () =>
    ipcRenderer.invoke("updater:check") as Promise<{
      version: string;
      body?: string;
    } | null>,
  downloadAndInstallUpdate: () => ipcRenderer.invoke("updater:downloadAndInstall"),
  relaunch: () => ipcRenderer.invoke("app:relaunch"),
});
