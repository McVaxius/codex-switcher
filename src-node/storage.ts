import fs from "node:fs";
import path from "node:path";
import {
  type AccountsStore,
  type StoredAccount,
  AUTH_MODE_CHATGPT,
  defaultAccountsStore,
  normalizeStore,
} from "./types.js";
import { getAccountsFile } from "./paths.js";

export function loadAccounts(): AccountsStore {
  const file = getAccountsFile();
  if (!fs.existsSync(file)) return defaultAccountsStore();

  try {
    return normalizeStore(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    throw new Error(`Failed to parse accounts file: ${file}: ${formatError(error)}`);
  }
}

export function saveAccounts(store: AccountsStore): void {
  const file = getAccountsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  if (process.platform !== "win32") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Best effort only on filesystems that do not support chmod.
    }
  }
}

export function addAccount(account: StoredAccount): StoredAccount {
  const store = loadAccounts();
  if (store.accounts.some((existing) => existing.name === account.name)) {
    throw new Error(`An account with name '${account.name}' already exists`);
  }

  store.accounts.push(account);
  if (store.accounts.length === 1) {
    store.active_account_id = account.id;
  }

  saveAccounts(store);
  return account;
}

export function removeAccount(accountId: string): void {
  const store = loadAccounts();
  const initialLength = store.accounts.length;
  store.accounts = store.accounts.filter((account) => account.id !== accountId);

  if (store.accounts.length === initialLength) {
    throw new Error(`Account not found: ${accountId}`);
  }

  if (store.active_account_id === accountId) {
    store.active_account_id = store.accounts[0]?.id ?? null;
  }

  store.masked_account_ids = store.masked_account_ids.filter((id) => id !== accountId);
  saveAccounts(store);
}

export function setActiveAccount(accountId: string): void {
  const store = loadAccounts();
  if (!store.accounts.some((account) => account.id === accountId)) {
    throw new Error(`Account not found: ${accountId}`);
  }
  store.active_account_id = accountId;
  saveAccounts(store);
}

export function getAccount(accountId: string): StoredAccount | null {
  return loadAccounts().accounts.find((account) => account.id === accountId) ?? null;
}

export function getActiveAccount(): StoredAccount | null {
  const store = loadAccounts();
  if (!store.active_account_id) return null;
  return store.accounts.find((account) => account.id === store.active_account_id) ?? null;
}

export function touchAccount(accountId: string): void {
  const store = loadAccounts();
  const account = store.accounts.find((entry) => entry.id === accountId);
  if (!account) return;
  account.last_used_at = new Date().toISOString();
  saveAccounts(store);
}

export function updateAccountMetadata(
  accountId: string,
  update: {
    name?: string;
    email?: string | null;
    planType?: string | null;
    subscriptionExpiresAt?: string | null;
  }
): StoredAccount {
  const store = loadAccounts();

  if (
    update.name !== undefined &&
    store.accounts.some(
      (account) => account.id !== accountId && account.name === update.name
    )
  ) {
    throw new Error(`An account with name '${update.name}' already exists`);
  }

  const account = store.accounts.find((entry) => entry.id === accountId);
  if (!account) throw new Error("Account not found");

  if (update.name !== undefined) account.name = update.name;
  if (update.email !== undefined) account.email = update.email;
  if (update.planType !== undefined) account.plan_type = update.planType;
  if (update.subscriptionExpiresAt !== undefined) {
    account.subscription_expires_at = update.subscriptionExpiresAt;
  }

  saveAccounts(store);
  return account;
}

export function updateAccountChatGptTokens(
  accountId: string,
  update: {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    chatGptAccountId: string | null;
    email: string | null;
    planType: string | null;
    subscriptionExpiresAt: string | null;
  }
): StoredAccount {
  const store = loadAccounts();
  const account = store.accounts.find((entry) => entry.id === accountId);
  if (!account) throw new Error("Account not found");
  if (account.auth_data.type !== AUTH_MODE_CHATGPT) {
    throw new Error("Cannot update OAuth tokens for an API key account");
  }

  account.auth_data.id_token = update.idToken;
  account.auth_data.access_token = update.accessToken;
  account.auth_data.refresh_token = update.refreshToken;
  if (update.chatGptAccountId) account.auth_data.account_id = update.chatGptAccountId;
  if (update.email) account.email = update.email;
  if (update.planType) account.plan_type = update.planType;
  if (update.subscriptionExpiresAt) {
    account.subscription_expires_at = update.subscriptionExpiresAt;
  }

  saveAccounts(store);
  return account;
}

export function getMaskedAccountIds(): string[] {
  return loadAccounts().masked_account_ids;
}

export function setMaskedAccountIds(ids: string[]): void {
  const store = loadAccounts();
  store.masked_account_ids = ids;
  saveAccounts(store);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
