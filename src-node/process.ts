import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodexProcessInfo } from "./types.js";

const execFileAsync = promisify(execFile);

interface WindowsCodexProcess {
  Name: string;
  ProcessId: number;
  ParentProcessId: number;
  CommandLine: string;
  MainWindowTitle: string;
}

export async function checkCodexProcesses(): Promise<CodexProcessInfo> {
  const { pids, backgroundCount } =
    process.platform === "win32"
      ? await findWindowsCodexProcesses()
      : await findUnixCodexProcesses();

  return {
    count: pids.length,
    background_count: backgroundCount,
    can_switch: pids.length === 0,
    pids,
  };
}

export async function findAntigravityProcesses(): Promise<number[]> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "tasklist.exe",
      ["/FI", "IMAGENAME eq codex.exe", "/FO", "CSV", "/NH"],
      { windowsHide: true }
    );

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const parts = parseCsvLine(line);
        const name = (parts[0] ?? "").toLowerCase();
        const pid = Number(parts[1]);
        return name === "codex.exe" && Number.isFinite(pid) ? [pid] : [];
      });
  }

  const { stdout } = await execFileAsync("ps", ["-eo", "pid,command"]);
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return [];
      const command = match[2];
      const isAntigravity =
        (command.includes(".antigravity/extensions/openai.chatgpt") ||
          command.includes(".vscode/extensions/openai.chatgpt")) &&
        (command.endsWith("codex app-server --analytics-default-enabled") ||
          command.includes("/codex app-server"));
      return isAntigravity ? [Number(match[1])] : [];
    });
}

export async function killProcess(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/F", "/PID", String(pid)], {
      windowsHide: true,
    }).catch(() => undefined);
    return;
  }

  await execFileAsync("kill", ["-9", String(pid)]).catch(() => undefined);
}

async function findUnixCodexProcesses(): Promise<{
  pids: number[];
  backgroundCount: number;
}> {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("ps", ["-axo", "pid=,tty=,command="]));
  } catch {
    return { pids: [], backgroundCount: 0 };
  }

  const pids: number[] = [];
  let backgroundCount = 0;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const pid = Number(parts.shift());
    const tty = parts.shift();
    const command = parts.join(" ");
    if (!Number.isFinite(pid) || !tty || !command) continue;

    const lower = command.toLowerCase();
    if (lower.includes("codex-switcher")) continue;

    const firstToken = command.split(/\s+/)[0] ?? "";
    const isCodexCli = firstToken === "codex" || firstToken.endsWith("/codex");
    const isCodexDesktop =
      command.includes(".app/Contents/MacOS/Codex") &&
      !command.includes("Codex Helper") &&
      !command.includes("CodexBar");

    if (!isCodexCli && !isCodexDesktop) continue;
    if (pid === process.pid || pids.includes(pid)) continue;

    const isIdePlugin = isIdePluginProcess(lower);
    const isAppServer = lower.includes("codex app-server");
    const hasTty = tty !== "??" && tty !== "?";

    if (isIdePlugin || isAppServer) {
      backgroundCount += 1;
      continue;
    }

    if (isCodexDesktop || hasTty) {
      pids.push(pid);
    } else {
      backgroundCount += 1;
    }
  }

  return {
    pids: uniqueSorted(pids),
    backgroundCount,
  };
}

async function findWindowsCodexProcesses(): Promise<{
  pids: number[];
  backgroundCount: number;
}> {
  const script = String.raw`
$windowTitles = @{}
Get-Process -Name Codex -ErrorAction SilentlyContinue | ForEach-Object {
  $windowTitles[[uint32]$_.Id] = $_.MainWindowTitle
}

Get-CimInstance Win32_Process |
  Where-Object { $_.Name -ieq 'Codex.exe' -or $_.Name -ieq 'codex.exe' } |
  ForEach-Object {
    [PSCustomObject]@{
      Name = $_.Name
      ProcessId = [uint32]$_.ProcessId
      ParentProcessId = [uint32]$_.ParentProcessId
      CommandLine = if ($_.CommandLine) { $_.CommandLine } else { '' }
      MainWindowTitle = if ($windowTitles.ContainsKey([uint32]$_.ProcessId)) {
        [string]$windowTitles[[uint32]$_.ProcessId]
      } else {
        ''
      }
    }
  } |
  ConvertTo-Json -Compress
`;

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  );

  const processes = parseWindowsCodexProcesses(stdout);
  const activePids: number[] = [];
  let ignoredCount = 0;

  for (const processInfo of processes.filter(isWindowsCodexRootProcess)) {
    const command = processInfo.CommandLine.toLowerCase();
    if (isIdePluginProcess(command)) {
      ignoredCount += 1;
      continue;
    }

    const hasWindow = processInfo.MainWindowTitle.trim().length > 0;
    const hasRenderer = windowsHasDescendantMatching(
      processInfo.ProcessId,
      processes,
      (child) => child.CommandLine.toLowerCase().includes("--type=renderer")
    );
    const hasAppServer = windowsHasDescendantMatching(
      processInfo.ProcessId,
      processes,
      (child) => {
        const childCommand = child.CommandLine.toLowerCase();
        return (
          childCommand.includes("resources\\codex.exe") &&
          childCommand.includes("app-server")
        );
      }
    );

    if (hasWindow || hasRenderer || hasAppServer) {
      activePids.push(processInfo.ProcessId);
    } else {
      ignoredCount += 1;
    }
  }

  return {
    pids: uniqueSorted(activePids),
    backgroundCount: ignoredCount,
  };
}

function parseWindowsCodexProcesses(stdout: string): WindowsCodexProcess[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const value = JSON.parse(trimmed) as WindowsCodexProcess | WindowsCodexProcess[];
  return Array.isArray(value) ? value : [value];
}

function isWindowsCodexRootProcess(processInfo: WindowsCodexProcess): boolean {
  const name = processInfo.Name.toLowerCase();
  const command = processInfo.CommandLine.toLowerCase();
  return (
    name === "codex.exe" &&
    !command.includes("codex-switcher") &&
    !command.includes("--type=") &&
    !command.includes("resources\\codex.exe")
  );
}

function isIdePluginProcess(command: string): boolean {
  return (
    command.includes(".antigravity") ||
    command.includes("openai.chatgpt") ||
    command.includes(".vscode")
  );
}

function windowsHasDescendantMatching(
  rootPid: number,
  processes: WindowsCodexProcess[],
  predicate: (processInfo: WindowsCodexProcess) => boolean
): boolean {
  const queue = [rootPid];
  const visited = new Set<number>();

  while (queue.length > 0) {
    const parentPid = queue.pop();
    for (const processInfo of processes.filter(
      (entry) => entry.ParentProcessId === parentPid
    )) {
      if (visited.has(processInfo.ProcessId)) continue;
      visited.add(processInfo.ProcessId);

      if (predicate(processInfo)) return true;
      queue.push(processInfo.ProcessId);
    }
  }

  return false;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function parseCsvLine(line: string): string[] {
  return line
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""));
}
