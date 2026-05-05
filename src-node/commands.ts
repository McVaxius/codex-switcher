import {
  addAccount,
  getAccount,
  getActiveAccount,
  getMaskedAccountIds,
  loadAccounts,
  removeAccount,
  saveAccounts,
  setActiveAccount,
  setMaskedAccountIds,
  touchAccount,
  updateAccountMetadata,
} from "./storage.js";
import {
  accountInfoFromStored,
  type AccountInfo,
  type ImportAccountsSummary,
  type UsageInfo,
  type WarmupSummary,
  AUTH_MODE_API_KEY,
} from "./types.js";
import {
  importFromAuthJson,
  importFromAuthJsonContents,
  refreshChatGptTokens,
  switchToAccount,
} from "./auth.js";
import {
  fetchChatGptAccountMetadata,
  getAccountUsage,
  refreshAllUsage,
  warmupAccount as sendWarmup,
} from "./usage.js";
import {
  cancelOAuthLogin,
  completeOAuthLogin,
  startOAuthLogin,
} from "./oauth.js";
import {
  exportAccountsFullEncryptedBytes,
  exportAccountsSlimText,
  importAccountsFullEncryptedBytes,
  importAccountsSlimText,
  readEncryptedFile,
  writeEncryptedFile,
} from "./backup.js";
import {
  checkCodexProcesses,
  findAntigravityProcesses,
  killProcess,
} from "./process.js";

export async function invokeCommand(
  command: string,
  rawArgs: Record<string, unknown> = {}
): Promise<unknown> {
  const args = rawArgs ?? {};

  switch (command) {
    case "list_accounts":
      return listAccounts();
    case "get_active_account_info":
      return getActiveAccountInfo();
    case "add_account_from_file":
      return addAccountFromFile(
        stringArg(args, "path"),
        stringArg(args, "name")
      );
    case "add_account_from_auth_json_text":
      return addAccountFromAuthJsonText(
        stringArg(args, "name"),
        stringArg(args, "contents")
      );
    case "get_usage":
      return getUsage(accountIdArg(args));
    case "refresh_account_metadata":
      return refreshAccountMetadata(accountIdArg(args));
    case "refresh_all_accounts_usage":
      return refreshAllUsage(loadAccounts().accounts);
    case "warmup_account":
      return warmupAccount(accountIdArg(args));
    case "warmup_all_accounts":
      return warmupAllAccounts();
    case "switch_account":
      return switchAccount(accountIdArg(args));
    case "delete_account":
      return deleteAccount(accountIdArg(args));
    case "rename_account":
      return renameAccount(accountIdArg(args), stringArg(args, "newName", "new_name"));
    case "start_login":
      return startOAuthLogin(stringArg(args, "accountName", "account_name"));
    case "complete_login":
      return completeLogin();
    case "cancel_login":
      await cancelOAuthLogin();
      return null;
    case "export_accounts_slim_text":
      return exportAccountsSlimText(loadAccounts());
    case "import_accounts_slim_text":
      return importSlimText(stringArg(args, "payload"));
    case "export_accounts_full_encrypted_file":
      return exportFullEncryptedFile(stringArg(args, "path"));
    case "import_accounts_full_encrypted_file":
      return importFullEncryptedFile(stringArg(args, "path"));
    case "export_accounts_full_encrypted_bytes":
      return exportAccountsFullEncryptedBytes(loadAccounts()).toString("base64");
    case "import_accounts_full_encrypted_bytes":
      return importFullEncryptedBytes(stringArg(args, "contentsBase64", "contents_base64"));
    case "get_masked_account_ids":
      return getMaskedAccountIds();
    case "set_masked_account_ids":
      setMaskedAccountIds(arrayArg(args, "ids"));
      return null;
    case "check_codex_processes":
      return checkCodexProcesses();
    default:
      throw new Error(`Unsupported command: ${command}`);
  }
}

async function listAccounts(): Promise<AccountInfo[]> {
  const store = loadAccounts();
  return store.accounts.map((account) =>
    accountInfoFromStored(account, store.active_account_id)
  );
}

async function getActiveAccountInfo(): Promise<AccountInfo | null> {
  const store = loadAccounts();
  const active = getActiveAccount();
  return active ? accountInfoFromStored(active, store.active_account_id) : null;
}

async function addAccountFromFile(
  filePath: string,
  name: string
): Promise<AccountInfo> {
  const stored = addAccount(importFromAuthJson(filePath, name));
  const store = loadAccounts();
  return accountInfoFromStored(stored, store.active_account_id);
}

async function addAccountFromAuthJsonText(
  name: string,
  contents: string
): Promise<AccountInfo> {
  const stored = addAccount(importFromAuthJsonContents(contents, name));
  const store = loadAccounts();
  return accountInfoFromStored(stored, store.active_account_id);
}

async function getUsage(accountId: string): Promise<UsageInfo> {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);
  return getAccountUsage(account);
}

async function refreshAccountMetadata(accountId: string): Promise<AccountInfo> {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);

  let updated = account;
  if (account.auth_data.type !== AUTH_MODE_API_KEY) {
    const refreshed = await refreshChatGptTokens(account);
    const metadata = await fetchChatGptAccountMetadata(refreshed);
    updated = updateAccountMetadata(accountId, {
      planType: metadata.planType ?? undefined,
      subscriptionExpiresAt: metadata.subscriptionExpiresAt,
    });
  }

  const store = loadAccounts();
  return accountInfoFromStored(updated, store.active_account_id);
}

async function warmupAccount(accountId: string): Promise<null> {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);
  await sendWarmup(account);
  return null;
}

async function warmupAllAccounts(): Promise<WarmupSummary> {
  const accounts = loadAccounts().accounts;
  const results = await runWithConcurrency(
    accounts,
    async (account) => {
      try {
        await sendWarmup(account);
        return { accountId: account.id, failed: false };
      } catch {
        return { accountId: account.id, failed: true };
      }
    },
    Math.min(Math.max(accounts.length, 1), 10)
  );

  const failed = results
    .filter((result) => result.failed)
    .map((result) => result.accountId);

  return {
    total_accounts: accounts.length,
    warmed_accounts: accounts.length - failed.length,
    failed_account_ids: failed,
  };
}

async function switchAccount(accountId: string): Promise<null> {
  const store = loadAccounts();
  const account = store.accounts.find((entry) => entry.id === accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);

  switchToAccount(account);
  setActiveAccount(accountId);
  touchAccount(accountId);

  try {
    const pids = await findAntigravityProcesses();
    await Promise.all(pids.map((pid) => killProcess(pid)));
  } catch {
    // Matching Rust behavior: helper restart is best effort.
  }

  return null;
}

async function deleteAccount(accountId: string): Promise<null> {
  removeAccount(accountId);
  return null;
}

async function renameAccount(accountId: string, newName: string): Promise<null> {
  updateAccountMetadata(accountId, { name: newName });
  return null;
}

async function completeLogin(): Promise<AccountInfo> {
  const account = await completeOAuthLogin();
  const stored = addAccount(account);
  setActiveAccount(stored.id);
  switchToAccount(stored);
  touchAccount(stored.id);

  const store = loadAccounts();
  return accountInfoFromStored(stored, store.active_account_id);
}

async function importSlimText(payload: string): Promise<ImportAccountsSummary> {
  try {
    const { store, summary } = await importAccountsSlimText(loadAccounts(), payload);
    saveAccounts(store);
    return summary;
  } catch (error) {
    throw new Error(
      `${formatError(error)}\nHint: Slim import needs network access to refresh ChatGPT tokens. You can use Full encrypted file import when offline.`
    );
  }
}

async function exportFullEncryptedFile(filePath: string): Promise<null> {
  writeEncryptedFile(filePath, exportAccountsFullEncryptedBytes(loadAccounts()));
  return null;
}

async function importFullEncryptedFile(
  filePath: string
): Promise<ImportAccountsSummary> {
  const { store, summary } = importAccountsFullEncryptedBytes(
    loadAccounts(),
    readEncryptedFile(filePath)
  );
  saveAccounts(store);
  return summary;
}

async function importFullEncryptedBytes(
  contentsBase64: string
): Promise<ImportAccountsSummary> {
  const { store, summary } = importAccountsFullEncryptedBytes(
    loadAccounts(),
    Buffer.from(contentsBase64, "base64")
  );
  saveAccounts(store);
  return summary;
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(runners);
  return results;
}

function accountIdArg(args: Record<string, unknown>): string {
  return stringArg(args, "accountId", "account_id");
}

function stringArg(
  args: Record<string, unknown>,
  primary: string,
  alias?: string
): string {
  const value = args[primary] ?? (alias ? args[alias] : undefined);
  if (typeof value !== "string") {
    throw new Error(`Invalid command payload: missing ${primary}`);
  }
  return value;
}

function arrayArg(args: Record<string, unknown>, name: string): string[] {
  const value = args[name];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Invalid command payload: missing ${name}`);
  }
  return value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
