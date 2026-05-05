import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type AuthDotJson,
  type StoredAccount,
  AUTH_MODE_API_KEY,
  AUTH_MODE_CHATGPT,
  parseChatGptIdTokenClaims,
} from "./types.js";
import { getCodexAuthFile, getCodexHome } from "./paths.js";
import {
  updateAccountChatGptTokens,
  loadAccounts,
} from "./storage.js";

const DEFAULT_ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const EXPIRY_SKEW_SECONDS = 60;

interface RefreshTokenResponse {
  id_token?: string;
  access_token: string;
  refresh_token?: string;
}

export function createApiKeyAccount(name: string, apiKey: string): StoredAccount {
  return {
    id: randomUUID(),
    name,
    email: null,
    plan_type: null,
    subscription_expires_at: null,
    auth_mode: AUTH_MODE_API_KEY,
    auth_data: {
      type: AUTH_MODE_API_KEY,
      key: apiKey,
    },
    created_at: new Date().toISOString(),
    last_used_at: null,
  };
}

export function createChatGptAccount(
  name: string,
  idToken: string,
  accessToken: string,
  refreshToken: string,
  accountId: string | null
): StoredAccount {
  const claims = parseChatGptIdTokenClaims(idToken);
  return {
    id: randomUUID(),
    name,
    email: claims.email,
    plan_type: claims.plan_type,
    subscription_expires_at: claims.subscription_expires_at,
    auth_mode: AUTH_MODE_CHATGPT,
    auth_data: {
      type: AUTH_MODE_CHATGPT,
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: claims.account_id ?? accountId,
    },
    created_at: new Date().toISOString(),
    last_used_at: null,
  };
}

export function switchToAccount(account: StoredAccount): void {
  const codexHome = getCodexHome();
  fs.mkdirSync(codexHome, { recursive: true });

  const authPath = path.join(codexHome, "auth.json");
  fs.writeFileSync(authPath, `${JSON.stringify(createAuthJson(account), null, 2)}\n`, "utf8");

  if (process.platform !== "win32") {
    try {
      fs.chmodSync(authPath, 0o600);
    } catch {
      // Best effort only.
    }
  }
}

export function importFromAuthJson(filePath: string, accountName: string): StoredAccount {
  const contents = fs.readFileSync(filePath, "utf8");
  try {
    return importFromAuthJsonContents(contents, accountName);
  } catch (error) {
    throw new Error(`Failed to parse auth.json: ${filePath}: ${formatError(error)}`);
  }
}

export function importFromAuthJsonContents(
  contents: string,
  accountName: string
): StoredAccount {
  let auth: AuthDotJson;
  try {
    auth = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Failed to parse auth.json contents: ${formatError(error)}`);
  }

  if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.length > 0) {
    return createApiKeyAccount(accountName, auth.OPENAI_API_KEY);
  }

  if (auth.tokens) {
    return createChatGptAccount(
      accountName,
      auth.tokens.id_token,
      auth.tokens.access_token,
      auth.tokens.refresh_token,
      auth.tokens.account_id ?? null
    );
  }

  throw new Error("auth.json contains neither API key nor tokens");
}

export function readCurrentAuth(): AuthDotJson | null {
  const file = getCodexAuthFile();
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function hasActiveLogin(): boolean {
  const auth = readCurrentAuth();
  return Boolean(auth?.OPENAI_API_KEY || auth?.tokens);
}

export async function ensureChatGptTokensFresh(
  account: StoredAccount
): Promise<StoredAccount> {
  if (account.auth_data.type !== AUTH_MODE_CHATGPT) return account;
  if (!tokenExpiredOrNearExpiry(account.auth_data.access_token)) return account;
  return refreshChatGptTokens(account);
}

export async function refreshChatGptTokens(account: StoredAccount): Promise<StoredAccount> {
  if (account.auth_data.type !== AUTH_MODE_CHATGPT) return account;

  const currentRefreshToken = account.auth_data.refresh_token;
  if (!currentRefreshToken.trim()) {
    throw new Error(`Missing refresh token for account ${account.name}`);
  }

  const refreshed = await refreshTokensWithRefreshToken(currentRefreshToken);
  const nextIdToken = refreshed.id_token ?? account.auth_data.id_token;
  const nextRefreshToken = refreshed.refresh_token ?? currentRefreshToken;
  const claims = parseChatGptIdTokenClaims(nextIdToken);
  const nextAccountId = claims.account_id ?? account.auth_data.account_id;
  const isActive = loadAccounts().active_account_id === account.id;

  const updated = updateAccountChatGptTokens(account.id, {
    idToken: nextIdToken,
    accessToken: refreshed.access_token,
    refreshToken: nextRefreshToken,
    chatGptAccountId: nextAccountId,
    email: claims.email,
    planType: claims.plan_type,
    subscriptionExpiresAt: claims.subscription_expires_at,
  });

  if (isActive) {
    try {
      switchToAccount(updated);
    } catch (error) {
      console.warn(`[Auth] Failed to sync active auth.json after token refresh: ${formatError(error)}`);
    }
  }

  return updated;
}

export async function createChatGptAccountFromRefreshToken(
  accountName: string,
  refreshToken: string
): Promise<StoredAccount> {
  if (!refreshToken.trim()) {
    throw new Error(`Missing refresh token for account ${accountName}`);
  }

  const refreshed = await refreshTokensWithRefreshToken(refreshToken);
  if (!refreshed.id_token) {
    throw new Error("Refresh response did not include id_token");
  }

  return createChatGptAccount(
    accountName,
    refreshed.id_token,
    refreshed.access_token,
    refreshed.refresh_token ?? refreshToken,
    null
  );
}

function createAuthJson(account: StoredAccount): AuthDotJson {
  if (account.auth_data.type === AUTH_MODE_API_KEY) {
    return { OPENAI_API_KEY: account.auth_data.key };
  }

  const tokens = {
    id_token: account.auth_data.id_token,
    access_token: account.auth_data.access_token,
    refresh_token: account.auth_data.refresh_token,
    ...(account.auth_data.account_id
      ? { account_id: account.auth_data.account_id }
      : {}),
  };

  return {
    tokens,
    last_refresh: new Date().toISOString(),
  };
}

function tokenExpiredOrNearExpiry(accessToken: string): boolean {
  const expiry = parseJwtExp(accessToken);
  if (expiry === null) return false;
  return expiry <= Math.floor(Date.now() / 1000) + EXPIRY_SKEW_SECONDS;
}

function parseJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

async function refreshTokensWithRefreshToken(
  refreshToken: string
): Promise<RefreshTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  }).toString();

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${DEFAULT_ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} - ${await response.text()}`);
      }

      return (await response.json()) as RefreshTokenResponse;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  throw new Error(`Failed to send token refresh request: ${formatError(lastError)}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
