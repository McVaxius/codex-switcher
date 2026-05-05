import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} from "electron";
import updater from "electron-updater";
import { invokeCommand } from "../src-node/commands.js";

const { autoUpdater } = updater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let updateDownloaded = false;

autoUpdater.autoDownload = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    title: "Codex Switcher",
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#f9fafb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("maximize", () => sendWindowState());
  mainWindow.on("unmaximize", () => sendWindowState());
  mainWindow.on("restore", () => sendWindowState());

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  } else {
    void mainWindow.loadURL("http://127.0.0.1:1420");
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpcHandlers(): void {
  ipcMain.handle(
    "codex:invoke",
    async (_event, command: string, args?: Record<string, unknown>) =>
      invokeCommand(command, args ?? {})
  );

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle("dialog:pickAuthJson", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Select auth.json file",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:saveFullBackup", async () => {
    const options: Electron.SaveDialogOptions = {
      title: "Export Full Encrypted Account Config",
      defaultPath: "codex-switcher-full.cswf",
      filters: [{ name: "Codex Switcher Full Backup", extensions: ["cswf"] }],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    return result.canceled ? null : result.filePath ?? null;
  });

  ipcMain.handle("dialog:pickFullBackup", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Import Full Encrypted Account Config",
      properties: ["openFile"],
      filters: [{ name: "Codex Switcher Full Backup", extensions: ["cswf"] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggleMaximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);

  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) return null;
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo;
    if (!info?.version) return null;
    return {
      version: info.version,
      body:
        typeof info.releaseNotes === "string"
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes.map((note) => note.note).join("\n")
            : "",
    };
  });

  ipcMain.handle("updater:downloadAndInstall", async () => {
    if (!app.isPackaged) return null;
    await autoUpdater.downloadUpdate();
    updateDownloaded = true;
    return null;
  });

  ipcMain.handle("app:relaunch", () => {
    if (updateDownloaded) {
      autoUpdater.quitAndInstall(false, true);
      return;
    }
    app.relaunch();
    app.exit(0);
  });
}

function sendWindowState(): void {
  mainWindow?.webContents.send("window:state", {
    isMaximized: mainWindow.isMaximized(),
  });
}
