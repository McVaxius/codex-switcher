export const AUTH_MODE_API_KEY = "api_key";
export const AUTH_MODE_CHATGPT = "chat_g_p_t";

export type AuthMode = typeof AUTH_MODE_API_KEY | typeof AUTH_MODE_CHATGPT;

export interface AccountsStore {
  version: number;
  accounts: StoredAccount[];
  active_account_id: string | null;
  masked_account_ids: string[];
}

export interface StoredAccount {
  id: string;
  name: string;
  email: string | null;
  plan_type: string | null;
  subscription_expires_at: string | null;
  auth_mode: AuthMode;
  auth_data: AuthData;
  created_at: string;
  last_used_at: string | null;
}

export type AuthData =
  | {
      type: typeof AUTH_MODE_API_KEY;
      key: string;
    }
  | {
      type: typeof AUTH_MODE_CHATGPT;
      id_token: string;
      access_token: string;
      refresh_token: string;
      account_id: string | null;
    };

export interface AuthDotJson {
  OPENAI_API_KEY?: string;
  tokens?: TokenData;
  last_refresh?: string;
}

export interface TokenData {
  id_token: string;
  access_token: string;
  refresh_token: string;
  account_id?: string;
}

export interface ChatGptIdTokenClaims {
  email: string | null;
  plan_type: string | null;
  account_id: string | null;
  subscription_expires_at: string | null;
}

export interface AccountInfo {
  id: string;
  name: string;
  email: string | null;
  plan_type: string | null;
  subscription_expires_at: string | null;
  auth_mode: AuthMode;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface UsageInfo {
  account_id: string;
  plan_type: string | null;
  primary_used_percent: number | null;
  primary_window_minutes: number | null;
  primary_resets_at: number | null;
  secondary_used_percent: number | null;
  secondary_window_minutes: number | null;
  secondary_resets_at: number | null;
  has_credits: boolean | null;
  unlimited_credits: boolean | null;
  credits_balance: string | null;
  error: string | null;
}

export interface OAuthLoginInfo {
  auth_url: string;
  callback_port: number;
}

export interface WarmupSummary {
  total_accounts: number;
  warmed_accounts: number;
  failed_account_ids: string[];
}

export interface ImportAccountsSummary {
  total_in_payload: number;
  imported_count: number;
  skipped_count: number;
}

export interface CodexProcessInfo {
  count: number;
  background_count: number;
  can_switch: boolean;
  pids: number[];
}

export interface RateLimitStatusPayload {
  plan_type: string;
  rate_limit?: {
    primary_window?: RateLimitWindow | null;
    secondary_window?: RateLimitWindow | null;
  } | null;
  credits?: {
    has_credits: boolean;
    unlimited: boolean;
    balance?: string | null;
  } | null;
}

export interface RateLimitWindow {
  used_percent: number;
  limit_window_seconds?: number | null;
  reset_at?: number | null;
}

export function defaultAccountsStore(): AccountsStore {
  return {
    version: 1,
    accounts: [],
    active_account_id: null,
    masked_account_ids: [],
  };
}

export function parseChatGptIdTokenClaims(idToken: string): ChatGptIdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) return emptyClaims();

  try {
    const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const authClaims = json["https://api.openai.com/auth"];
    return {
      email: asString(json.email),
      plan_type: asString(authClaims?.chatgpt_plan_type),
      account_id: asString(authClaims?.chatgpt_account_id),
      subscription_expires_at: normalizeDateString(
        asString(authClaims?.chatgpt_subscription_active_until)
      ),
    };
  } catch {
    return emptyClaims();
  }
}

export function accountInfoFromStored(
  account: StoredAccount,
  activeId: string | null
): AccountInfo {
  const fallbackExpiry =
    account.auth_data.type === AUTH_MODE_CHATGPT
      ? parseChatGptIdTokenClaims(account.auth_data.id_token).subscription_expires_at
      : null;

  return {
    id: account.id,
    name: account.name,
    email: account.email,
    plan_type: account.plan_type,
    subscription_expires_at: account.subscription_expires_at ?? fallbackExpiry,
    auth_mode: account.auth_mode,
    is_active: activeId === account.id,
    created_at: account.created_at,
    last_used_at: account.last_used_at,
  };
}

export function usageError(accountId: string, error: string): UsageInfo {
  return {
    account_id: accountId,
    plan_type: null,
    primary_used_percent: null,
    primary_window_minutes: null,
    primary_resets_at: null,
    secondary_used_percent: null,
    secondary_window_minutes: null,
    secondary_resets_at: null,
    has_credits: null,
    unlimited_credits: null,
    credits_balance: null,
    error,
  };
}

export function normalizeStore(value: Partial<AccountsStore> | null | undefined): AccountsStore {
  const store = value ?? {};
  return {
    version: typeof store.version === "number" ? store.version : 1,
    accounts: Array.isArray(store.accounts)
      ? store.accounts.map(normalizeAccount)
      : [],
    active_account_id:
      typeof store.active_account_id === "string" ? store.active_account_id : null,
    masked_account_ids: Array.isArray(store.masked_account_ids)
      ? store.masked_account_ids.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function normalizeAccount(account: StoredAccount): StoredAccount {
  return {
    ...account,
    email: account.email ?? null,
    plan_type: account.plan_type ?? null,
    subscription_expires_at: account.subscription_expires_at ?? null,
    last_used_at: account.last_used_at ?? null,
  };
}

function emptyClaims(): ChatGptIdTokenClaims {
  return {
    email: null,
    plan_type: null,
    account_id: null,
    subscription_expires_at: null,
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeDateString(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}
