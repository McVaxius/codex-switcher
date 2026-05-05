import fs from "node:fs";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  type AccountsStore,
  type ImportAccountsSummary,
  type StoredAccount,
  AUTH_MODE_API_KEY,
  AUTH_MODE_CHATGPT,
  defaultAccountsStore,
  normalizeStore,
} from "./types.js";
import {
  createApiKeyAccount,
  createChatGptAccountFromRefreshToken,
} from "./auth.js";

const SLIM_EXPORT_PREFIX = "css1.";
const SLIM_FORMAT_VERSION = 1;
const SLIM_AUTH_API_KEY = 0;
const SLIM_AUTH_CHATGPT = 1;

const FULL_FILE_MAGIC = Buffer.from("CSWF", "ascii");
const FULL_FILE_VERSION = 1;
const FULL_SALT_LEN = 16;
const FULL_NONCE_LEN = 24;
const FULL_KDF_ITERATIONS = 210_000;
const FULL_PRESET_PASSPHRASE =
  "gT7kQ9mV2xN4pL8sR1dH6zW3cB5yF0uJ_aE7nK2tP9vM4rX1";

const MAX_IMPORT_JSON_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;
const SLIM_IMPORT_CONCURRENCY = 6;

interface SlimPayload {
  v: number;
  a?: string;
  c: SlimAccountPayload[];
}

interface SlimAccountPayload {
  n: string;
  t: number;
  k?: string;
  r?: string;
}

export function exportAccountsSlimText(store: AccountsStore): string {
  const activeName = store.active_account_id
    ? store.accounts.find((account) => account.id === store.active_account_id)?.name
    : undefined;

  const payload: SlimPayload = {
    v: SLIM_FORMAT_VERSION,
    ...(activeName ? { a: activeName } : {}),
    c: store.accounts.map((account) => {
      if (account.auth_data.type === AUTH_MODE_API_KEY) {
        return {
          n: account.name,
          t: SLIM_AUTH_API_KEY,
          k: account.auth_data.key,
        };
      }

      return {
        n: account.name,
        t: SLIM_AUTH_CHATGPT,
        r: account.auth_data.refresh_token,
      };
    }),
  };

  const compressed = deflateSync(Buffer.from(JSON.stringify(payload), "utf8"), {
    level: 9,
  });
  return `${SLIM_EXPORT_PREFIX}${compressed.toString("base64url")}`;
}

export async function importAccountsSlimText(
  current: AccountsStore,
  text: string
): Promise<{ store: AccountsStore; summary: ImportAccountsSummary }> {
  const payload = decodeSlimPayload(text);
  const totalInPayload = payload.c.length;
  const existingNames = new Set(current.accounts.map((account) => account.name));
  const imported = await buildStoreFromSlimPayload(payload, existingNames);
  validateImportedStore(imported);
  const { store, summary } = mergeAccountsStore(current, imported);

  return {
    store,
    summary: {
      total_in_payload: totalInPayload,
      imported_count: summary.imported_count,
      skipped_count: totalInPayload - summary.imported_count,
    },
  };
}

export function exportAccountsFullEncryptedBytes(store: AccountsStore): Buffer {
  const json = Buffer.from(JSON.stringify(store), "utf8");
  const compressed = deflateSync(json, { level: 9 });
  const salt = randomBytes(FULL_SALT_LEN);
  const nonce = randomBytes(FULL_NONCE_LEN);
  const key = deriveEncryptionKey(FULL_PRESET_PASSPHRASE, salt);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = Buffer.from(cipher.encrypt(compressed));

  return Buffer.concat([
    FULL_FILE_MAGIC,
    Buffer.from([FULL_FILE_VERSION]),
    salt,
    nonce,
    ciphertext,
  ]);
}

export function importAccountsFullEncryptedBytes(
  current: AccountsStore,
  bytes: Buffer
): { store: AccountsStore; summary: ImportAccountsSummary } {
  const imported = decodeFullEncryptedStore(bytes);
  validateImportedStore(imported);
  return mergeAccountsStore(current, imported);
}

export function writeEncryptedFile(filePath: string, bytes: Buffer): void {
  fs.writeFileSync(filePath, bytes);
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort only.
    }
  }
}

export function readEncryptedFile(filePath: string): Buffer {
  const metadata = fs.statSync(filePath);
  if (metadata.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("Encrypted file is too large");
  }
  return fs.readFileSync(filePath);
}

function decodeSlimPayload(payloadText: string): SlimPayload {
  const normalized = payloadText.replace(/\s+/g, "");
  if (!normalized) throw new Error("Import string is empty");

  const encoded = normalized.startsWith(SLIM_EXPORT_PREFIX)
    ? normalized.slice(SLIM_EXPORT_PREFIX.length)
    : normalized;
  const compressed = Buffer.from(encoded, "base64url");
  const decompressed = inflateWithLimit(compressed, MAX_IMPORT_JSON_BYTES);
  const parsed = JSON.parse(decompressed.toString("utf8")) as SlimPayload;
  validateSlimPayload(parsed);
  return parsed;
}

function validateSlimPayload(payload: SlimPayload): void {
  if (payload.v !== SLIM_FORMAT_VERSION) {
    throw new Error(`Unsupported slim payload version: ${payload.v}`);
  }
  if (!Array.isArray(payload.c)) {
    throw new Error("Slim import accounts payload is missing");
  }

  const names = new Set<string>();
  for (const account of payload.c) {
    if (!account.n?.trim()) {
      throw new Error("Slim import contains an account with empty name");
    }
    if (names.has(account.n)) {
      throw new Error(`Slim import contains duplicate account name: ${account.n}`);
    }
    names.add(account.n);

    if (account.t === SLIM_AUTH_API_KEY) {
      if (!account.k?.trim()) {
        throw new Error(`API key is missing for account ${account.n}`);
      }
    } else if (account.t === SLIM_AUTH_CHATGPT) {
      if (!account.r?.trim()) {
        throw new Error(`Refresh token is missing for account ${account.n}`);
      }
    } else {
      throw new Error(`Unsupported auth type ${account.t} for account ${account.n}`);
    }
  }

  if (payload.a && !names.has(payload.a)) {
    throw new Error(`Slim import references missing active account: ${payload.a}`);
  }
}

async function buildStoreFromSlimPayload(
  payload: SlimPayload,
  existingNames: Set<string>
): Promise<AccountsStore> {
  const candidates = payload.c.filter((entry) => !existingNames.has(entry.n));
  const accounts = await restoreSlimAccounts(candidates);
  const activeAccountId =
    (payload.a
      ? accounts.find((account) => account.name === payload.a)?.id
      : undefined) ??
    accounts[0]?.id ??
    null;

  return {
    version: 1,
    accounts,
    active_account_id: activeAccountId,
    masked_account_ids: [],
  };
}

async function restoreSlimAccounts(entries: SlimAccountPayload[]): Promise<StoredAccount[]> {
  return runWithConcurrency(entries, async (entry) => {
    if (entry.t === SLIM_AUTH_API_KEY) {
      if (!entry.k) throw new Error("API key payload is missing");
      return createApiKeyAccount(entry.n, entry.k);
    }

    if (entry.t === SLIM_AUTH_CHATGPT) {
      if (!entry.r) throw new Error("Refresh token payload is missing");
      try {
        return await createChatGptAccountFromRefreshToken(entry.n, entry.r);
      } catch (error) {
        throw new Error(
          `Failed to restore ChatGPT account \`${entry.n}\` from refresh token: ${formatError(error)}`
        );
      }
    }

    throw new Error("Unsupported auth type in slim payload");
  }, SLIM_IMPORT_CONCURRENCY);
}

function decodeFullEncryptedStore(bytes: Buffer): AccountsStore {
  if (bytes.length > MAX_IMPORT_FILE_BYTES) {
    throw new Error("Encrypted file is too large");
  }

  const headerLength = 4 + 1 + FULL_SALT_LEN + FULL_NONCE_LEN;
  if (bytes.length <= headerLength) {
    throw new Error("Encrypted file is invalid or truncated");
  }
  if (!bytes.subarray(0, 4).equals(FULL_FILE_MAGIC)) {
    throw new Error("Encrypted file header is invalid");
  }
  if (bytes[4] !== FULL_FILE_VERSION) {
    throw new Error(`Unsupported encrypted file version: ${bytes[4]}`);
  }

  const saltStart = 5;
  const nonceStart = saltStart + FULL_SALT_LEN;
  const ciphertextStart = nonceStart + FULL_NONCE_LEN;
  const salt = bytes.subarray(saltStart, nonceStart);
  const nonce = bytes.subarray(nonceStart, ciphertextStart);
  const ciphertext = bytes.subarray(ciphertextStart);
  const key = deriveEncryptionKey(FULL_PRESET_PASSPHRASE, salt);

  try {
    const cipher = xchacha20poly1305(key, nonce);
    const compressed = Buffer.from(cipher.decrypt(ciphertext));
    const json = inflateWithLimit(compressed, MAX_IMPORT_JSON_BYTES);
    return normalizeStore(JSON.parse(json.toString("utf8")));
  } catch (error) {
    throw new Error(`Failed to decrypt file (wrong passphrase or corrupted file): ${formatError(error)}`);
  }
}

function deriveEncryptionKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, FULL_KDF_ITERATIONS, 32, "sha256");
}

function inflateWithLimit(input: Buffer, maxBytes: number): Buffer {
  const inflated = inflateSync(input, { maxOutputLength: maxBytes + 1 });
  if (inflated.length > maxBytes) {
    throw new Error("Import data is too large");
  }
  return inflated;
}

function validateImportedStore(store: AccountsStore): void {
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const account of store.accounts) {
    if (!account.id?.trim()) throw new Error("Import contains an account with empty id");
    if (!account.name?.trim()) {
      throw new Error("Import contains an account with empty name");
    }
    if (ids.has(account.id)) {
      throw new Error(`Import contains duplicate account id: ${account.id}`);
    }
    if (names.has(account.name)) {
      throw new Error(`Import contains duplicate account name: ${account.name}`);
    }
    ids.add(account.id);
    names.add(account.name);
  }

  if (store.active_account_id && !ids.has(store.active_account_id)) {
    throw new Error(`Import references a missing active account: ${store.active_account_id}`);
  }
}

function mergeAccountsStore(
  currentStore: AccountsStore,
  importedStore: AccountsStore
): { store: AccountsStore; summary: ImportAccountsSummary } {
  const current = normalizeStore(currentStore);
  const imported = normalizeStore(importedStore);
  const totalInPayload = imported.accounts.length;
  let importedCount = 0;
  const existingIds = new Set(current.accounts.map((account) => account.id));
  const existingNames = new Set(current.accounts.map((account) => account.name));

  for (const account of imported.accounts) {
    if (existingIds.has(account.id) || existingNames.has(account.name)) continue;
    existingIds.add(account.id);
    existingNames.add(account.name);
    current.accounts.push(account);
    importedCount += 1;
  }

  current.version = Math.max(current.version, imported.version, defaultAccountsStore().version);
  const activeValid =
    current.active_account_id !== null &&
    current.accounts.some((account) => account.id === current.active_account_id);

  if (!activeValid) {
    current.active_account_id =
      imported.active_account_id &&
      current.accounts.some((account) => account.id === imported.active_account_id)
        ? imported.active_account_id
        : current.accounts[0]?.id ?? null;
  }

  return {
    store: current,
    summary: {
      total_in_payload: totalInPayload,
      imported_count: importedCount,
      skipped_count: totalInPayload - importedCount,
    },
  };
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const backupInternalsForTests = {
  exportAccountsSlimText,
  importAccountsFullEncryptedBytes,
  exportAccountsFullEncryptedBytes,
};
