import type { ImportAccountsSummary } from "../types";

export type FileSource = string | File;

export interface AppUpdateInfo {
  version: string;
  body?: string;
}

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.codexSwitcher);
}

export async function invokeBackend<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (isDesktopRuntime()) {
    return window.codexSwitcher!.invoke<T>(command, args);
  }

  const response = await fetch(`/api/invoke/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isDesktopRuntime()) {
    await window.codexSwitcher!.openExternalUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export async function pickAuthJsonFile(): Promise<FileSource | null> {
  if (isDesktopRuntime()) {
    return window.codexSwitcher!.pickAuthJsonFile();
  }

  return pickBrowserFile(".json,application/json");
}

export async function exportFullBackupFile(): Promise<boolean> {
  if (isDesktopRuntime()) {
    const selected = await window.codexSwitcher!.saveFullBackupFile();
    if (!selected) return false;
    await invokeBackend("export_accounts_full_encrypted_file", { path: selected });
    return true;
  }

  const contentsBase64 = await invokeBackend<string>("export_accounts_full_encrypted_bytes");
  downloadBase64File(
    contentsBase64,
    "codex-switcher-full.cswf",
    "application/octet-stream"
  );
  return true;
}

export async function importFullBackupFile(): Promise<ImportAccountsSummary | null> {
  if (isDesktopRuntime()) {
    const selected = await window.codexSwitcher!.pickFullBackupFile();
    if (!selected) return null;
    return invokeBackend<ImportAccountsSummary>("import_accounts_full_encrypted_file", {
      path: selected,
    });
  }

  const selected = await pickBrowserFile(".cswf,application/octet-stream");
  if (!selected) return null;

  const contentsBase64 = await fileToBase64(selected);
  return invokeBackend<ImportAccountsSummary>("import_accounts_full_encrypted_bytes", {
    contentsBase64,
  });
}

export function describeFileSource(source: FileSource | null): string {
  if (!source) return "No file selected";
  return typeof source === "string" ? source : source.name;
}

export async function minimizeWindow(): Promise<void> {
  await window.codexSwitcher?.minimizeWindow();
}

export async function toggleMaximizeWindow(): Promise<void> {
  await window.codexSwitcher?.toggleMaximizeWindow();
}

export async function closeWindow(): Promise<void> {
  await window.codexSwitcher?.closeWindow();
}

export async function isWindowMaximized(): Promise<boolean> {
  return window.codexSwitcher?.isWindowMaximized() ?? false;
}

export function onWindowStateChanged(
  listener: (state: { isMaximized: boolean }) => void
): () => void {
  return window.codexSwitcher?.onWindowStateChanged(listener) ?? (() => {});
}

export async function checkForUpdate(): Promise<AppUpdateInfo | null> {
  return window.codexSwitcher?.checkForUpdate() ?? null;
}

export async function downloadAndInstallUpdate(): Promise<void> {
  await window.codexSwitcher?.downloadAndInstallUpdate();
}

export async function relaunchApp(): Promise<void> {
  await window.codexSwitcher?.relaunch();
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    const chunk = bytes.subarray(index, index + 0x8000);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

function downloadBase64File(
  base64: string,
  fileName: string,
  mimeType: string
): void {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function pickBrowserFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    let settled = false;

    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      input.remove();
      resolve(file);
    };

    const handleWindowFocus = () => {
      window.setTimeout(() => {
        finish(input.files?.[0] ?? null);
      }, 0);
    };

    input.addEventListener(
      "change",
      () => {
        finish(input.files?.[0] ?? null);
      },
      { once: true }
    );

    document.body.appendChild(input);
    window.addEventListener("focus", handleWindowFocus, { once: true });
    input.click();
  });
}

async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
