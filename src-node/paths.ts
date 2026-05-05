import { homedir } from "node:os";
import path from "node:path";

export function getHomeDir(): string {
  const home = homedir();
  if (!home) throw new Error("Could not find home directory");
  return home;
}

export function getConfigDir(): string {
  return path.join(getHomeDir(), ".codex-switcher");
}

export function getAccountsFile(): string {
  return path.join(getConfigDir(), "accounts.json");
}

export function getCodexHome(): string {
  return process.env.CODEX_HOME || path.join(getHomeDir(), ".codex");
}

export function getCodexAuthFile(): string {
  return path.join(getCodexHome(), "auth.json");
}
