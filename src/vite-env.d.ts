/// <reference types="vite/client" />

interface CodexSwitcherBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  openExternalUrl(url: string): Promise<void>;
  pickAuthJsonFile(): Promise<string | null>;
  saveFullBackupFile(): Promise<string | null>;
  pickFullBackupFile(): Promise<string | null>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  onWindowStateChanged(
    listener: (state: { isMaximized: boolean }) => void
  ): () => void;
  checkForUpdate(): Promise<{ version: string; body?: string } | null>;
  downloadAndInstallUpdate(): Promise<void>;
  relaunch(): Promise<void>;
}

interface Window {
  codexSwitcher?: CodexSwitcherBridge;
}
