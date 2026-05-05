import {
  ensureChatGptTokensFresh,
  refreshChatGptTokens,
} from "./auth.js";
import {
  type RateLimitStatusPayload,
  type RateLimitWindow,
  type StoredAccount,
  type UsageInfo,
  AUTH_MODE_API_KEY,
  AUTH_MODE_CHATGPT,
  usageError,
} from "./types.js";

const CHATGPT_BACKEND_API = "https://chatgpt.com/backend-api";
const CHATGPT_ACCOUNTS_CHECK_API =
  "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";
const CHATGPT_CODEX_RESPONSES_API =
  "https://chatgpt.com/backend-api/codex/responses";
const OPENAI_API = "https://api.openai.com/v1";
const CODEX_USER_AGENT = "codex-cli/1.0.0";

export interface ChatGptAccountMetadata {
  planType: string | null;
  subscriptionExpiresAt: string | null;
}

interface AccountsCheckResponse {
  accounts?: Record<
    string,
    {
      account?: { plan_type?: string | null } | null;
      entitlement?: { expires_at?: string | null } | null;
    }
  >;
}

export async function getAccountUsage(account: StoredAccount): Promise<UsageInfo> {
  if (account.auth_data.type === AUTH_MODE_API_KEY) {
    return {
      account_id: account.id,
      plan_type: "api_key",
      primary_used_percent: null,
      primary_window_minutes: null,
      primary_resets_at: null,
      secondary_used_percent: null,
      secondary_window_minutes: null,
      secondary_resets_at: null,
      has_credits: null,
      unlimited_credits: null,
      credits_balance: null,
      error: "Usage info not available for API key accounts",
    };
  }

  return getUsageWithChatGptAuth(account);
}

export async function warmupAccount(account: StoredAccount): Promise<void> {
  if (account.auth_data.type === AUTH_MODE_API_KEY) {
    await warmupWithApiKey(account.auth_data.key);
    return;
  }

  await warmupWithChatGptAuth(account);
}

export async function fetchChatGptAccountMetadata(
  account: StoredAccount
): Promise<ChatGptAccountMetadata> {
  const { accessToken, accountId } = extractChatGptAuth(account);
  const response = await sendChatGptGetRequest(
    CHATGPT_ACCOUNTS_CHECK_API,
    accessToken,
    accountId
  );

  if (!response.ok) {
    throw new Error(`Accounts check API error: ${response.status} - ${await response.text()}`);
  }

  const payload = (await response.json()) as AccountsCheckResponse;
  const accounts = payload.accounts ?? {};
  const selected =
    (accountId ? accounts[accountId] : undefined) ??
    accounts.default ??
    Object.values(accounts)[0];

  if (!selected) {
    throw new Error("Accounts check response did not include an account entry");
  }

  return {
    planType:
      typeof selected.account?.plan_type === "string"
        ? selected.account.plan_type
        : null,
    subscriptionExpiresAt: normalizeDateString(
      typeof selected.entitlement?.expires_at === "string"
        ? selected.entitlement.expires_at
        : null
    ),
  };
}

export async function refreshAllUsage(accounts: StoredAccount[]): Promise<UsageInfo[]> {
  return runWithConcurrency(
    accounts,
    async (account) => {
      try {
        return await getAccountUsage(account);
      } catch (error) {
        return usageError(account.id, formatError(error));
      }
    },
    Math.min(Math.max(accounts.length, 1), 10)
  );
}

async function getUsageWithChatGptAuth(account: StoredAccount): Promise<UsageInfo> {
  const freshAccount = await ensureChatGptTokensFresh(account);
  const { accessToken, accountId } = extractChatGptAuth(freshAccount);
  const response = await sendChatGptUsageRequest(accessToken, accountId);

  if (response.status === 401) {
    const refreshedAccount = await refreshChatGptTokens(freshAccount);
    const retryAuth = extractChatGptAuth(refreshedAccount);
    return parseUsageResponse(
      refreshedAccount.id,
      await sendChatGptUsageRequest(retryAuth.accessToken, retryAuth.accountId)
    );
  }

  return parseUsageResponse(freshAccount.id, response);
}

async function parseUsageResponse(
  accountId: string,
  response: Response
): Promise<UsageInfo> {
  if (!response.ok) {
    await response.text().catch(() => "");
    return usageError(accountId, `API error: ${response.status}`);
  }

  const payload = (await response.json()) as RateLimitStatusPayload;
  return convertPayloadToUsageInfo(accountId, payload);
}

async function warmupWithChatGptAuth(account: StoredAccount): Promise<void> {
  const freshAccount = await ensureChatGptTokensFresh(account);
  const { accessToken, accountId } = extractChatGptAuth(freshAccount);
  let response = await sendChatGptWarmupRequest(accessToken, accountId, true);

  if (response.status === 401) {
    const refreshedAccount = await refreshChatGptTokens(freshAccount);
    const retryAuth = extractChatGptAuth(refreshedAccount);
    response = await sendChatGptWarmupRequest(
      retryAuth.accessToken,
      retryAuth.accountId,
      true
    );
  }

  if (!response.ok) {
    await response.text().catch(() => "");
    throw new Error(`ChatGPT warm-up failed with status ${response.status}`);
  }

  await response.text().catch(() => "");
}

async function warmupWithApiKey(apiKey: string): Promise<void> {
  const response = await fetch(`${OPENAI_API}/responses`, {
    method: "POST",
    headers: {
      "User-Agent": CODEX_USER_AGENT,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildWarmupPayload(false, true)),
  });

  if (!response.ok) {
    await response.text().catch(() => "");
    throw new Error(`API key warm-up failed with status ${response.status}`);
  }

  await response.text().catch(() => "");
}

function buildWarmupPayload(stream: boolean, includeMaxOutputTokens: boolean): unknown {
  const payload: Record<string, unknown> = {
    model: "gpt-5.4-mini",
    instructions: "You are Codex.",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hi" }],
      },
    ],
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort: "low" },
    store: false,
    stream,
  };

  if (includeMaxOutputTokens) payload.max_output_tokens = 1;
  return payload;
}

function extractChatGptAuth(account: StoredAccount): {
  accessToken: string;
  accountId: string | null;
} {
  if (account.auth_data.type !== AUTH_MODE_CHATGPT) {
    throw new Error("Account is not using ChatGPT OAuth");
  }

  return {
    accessToken: account.auth_data.access_token,
    accountId: account.auth_data.account_id,
  };
}

function sendChatGptUsageRequest(
  accessToken: string,
  accountId: string | null
): Promise<Response> {
  return sendChatGptGetRequest(
    `${CHATGPT_BACKEND_API}/wham/usage`,
    accessToken,
    accountId
  );
}

function sendChatGptGetRequest(
  url: string,
  accessToken: string,
  accountId: string | null
): Promise<Response> {
  return fetch(url, {
    headers: buildChatGptHeaders(accessToken, accountId),
  });
}

function sendChatGptWarmupRequest(
  accessToken: string,
  accountId: string | null,
  stream: boolean
): Promise<Response> {
  return fetch(CHATGPT_CODEX_RESPONSES_API, {
    method: "POST",
    headers: {
      ...buildChatGptHeaders(accessToken, accountId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildWarmupPayload(stream, false)),
  });
}

function buildChatGptHeaders(
  accessToken: string,
  accountId: string | null
): Record<string, string> {
  return {
    "User-Agent": CODEX_USER_AGENT,
    Authorization: `Bearer ${accessToken}`,
    ...(accountId ? { "chatgpt-account-id": accountId } : {}),
  };
}

function convertPayloadToUsageInfo(
  accountId: string,
  payload: RateLimitStatusPayload
): UsageInfo {
  const primary = payload.rate_limit?.primary_window ?? null;
  const secondary = payload.rate_limit?.secondary_window ?? null;
  const credits = payload.credits ?? null;

  return {
    account_id: accountId,
    plan_type: payload.plan_type,
    primary_used_percent: primary?.used_percent ?? null,
    primary_window_minutes: windowMinutes(primary),
    primary_resets_at: primary?.reset_at ?? null,
    secondary_used_percent: secondary?.used_percent ?? null,
    secondary_window_minutes: windowMinutes(secondary),
    secondary_resets_at: secondary?.reset_at ?? null,
    has_credits: credits?.has_credits ?? null,
    unlimited_credits: credits?.unlimited ?? null,
    credits_balance: credits?.balance ?? null,
    error: null,
  };
}

function windowMinutes(window: RateLimitWindow | null): number | null {
  const seconds = window?.limit_window_seconds;
  return typeof seconds === "number" ? Math.floor((seconds + 59) / 60) : null;
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
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

function normalizeDateString(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
