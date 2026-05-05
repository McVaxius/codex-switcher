import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import {
  type OAuthLoginInfo,
  type StoredAccount,
} from "./types.js";
import { createChatGptAccount } from "./auth.js";

const DEFAULT_ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_PORT = 1455;
const LOGIN_TIMEOUT_MS = 300_000;

interface PendingOAuth {
  promise: Promise<StoredAccount>;
  cancel: () => void;
}

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

let pendingOAuth: PendingOAuth | null = null;

export async function startOAuthLogin(accountName: string): Promise<OAuthLoginInfo> {
  await cancelOAuthLogin();

  const pkce = generatePkce();
  const state = generateState();
  const server = await listenOnCallbackPort();
  const address = server.address();
  const callbackPort =
    typeof address === "object" && address ? address.port : DEFAULT_PORT;
  const redirectUri = `http://localhost:${callbackPort}/auth/callback`;
  const authUrl = buildAuthorizeUrl(redirectUri, pkce.codeChallenge, state);

  let settled = false;
  let timeout: NodeJS.Timeout | null = null;
  let rejectPending: ((error: Error) => void) | null = null;

  const promise = new Promise<StoredAccount>((resolve, reject) => {
    rejectPending = reject;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      server.close();
      fn();
    };

    timeout = setTimeout(() => {
      finish(() => reject(new Error("OAuth login timed out")));
    }, LOGIN_TIMEOUT_MS);

    server.on("request", (request, response) => {
      void handleOAuthRequest(
        request,
        response,
        {
          accountName,
          codeVerifier: pkce.codeVerifier,
          expectedState: state,
          redirectUri,
        },
        (account) => finish(() => resolve(account)),
        (error) => finish(() => reject(error))
      );
    });
  });

  pendingOAuth = {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      server.close();
      rejectPending?.(new Error("OAuth login cancelled"));
    },
  };

  return {
    auth_url: authUrl,
    callback_port: callbackPort,
  };
}

export async function completeOAuthLogin(): Promise<StoredAccount> {
  const pending = pendingOAuth;
  if (!pending) throw new Error("No pending OAuth login");
  pendingOAuth = null;
  return pending.promise;
}

export async function cancelOAuthLogin(): Promise<void> {
  if (!pendingOAuth) return;
  const pending = pendingOAuth;
  pendingOAuth = null;
  pending.cancel();
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

function generateState(): string {
  return randomBytes(32).toString("base64url");
}

function buildAuthorizeUrl(
  redirectUri: string,
  codeChallenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "codex_cli_rs",
  });

  return `${DEFAULT_ISSUER}/oauth/authorize?${params.toString()}`;
}

function listenOnCallbackPort(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", () => {
      const fallback = http.createServer();
      fallback.once("error", reject);
      fallback.listen(0, "127.0.0.1", () => resolve(fallback));
    });
    server.listen(DEFAULT_PORT, "127.0.0.1", () => resolve(server));
  });
}

async function handleOAuthRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: {
    accountName: string;
    codeVerifier: string;
    expectedState: string;
    redirectUri: string;
  },
  success: (account: StoredAccount) => void,
  failure: (error: Error) => void
): Promise<void> {
  const parsed = new URL(request.url ?? "/", "http://localhost");
  if (parsed.pathname !== "/auth/callback") {
    respondText(response, 404, "Not Found");
    return;
  }

  const providerError = parsed.searchParams.get("error");
  if (providerError) {
    const description =
      parsed.searchParams.get("error_description") ?? "Unknown error";
    respondText(response, 400, `OAuth Error: ${providerError} - ${description}`);
    failure(new Error(`OAuth error: ${providerError} - ${description}`));
    return;
  }

  if (parsed.searchParams.get("state") !== context.expectedState) {
    respondText(response, 400, "State mismatch");
    failure(new Error("OAuth state mismatch"));
    return;
  }

  const code = parsed.searchParams.get("code");
  if (!code) {
    respondText(response, 400, "Missing authorization code");
    failure(new Error("Missing authorization code"));
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(
      context.redirectUri,
      context.codeVerifier,
      code
    );
    respondHtml(response, successHtml());
    success(
      createChatGptAccount(
        context.accountName,
        tokens.id_token,
        tokens.access_token,
        tokens.refresh_token,
        null
      )
    );
  } catch (error) {
    respondText(response, 500, `Token exchange failed: ${formatError(error)}`);
    failure(error instanceof Error ? error : new Error(String(error)));
  }
}

async function exchangeCodeForTokens(
  redirectUri: string,
  codeVerifier: string,
  code: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const response = await fetch(`${DEFAULT_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} - ${await response.text()}`);
  }

  return (await response.json()) as TokenResponse;
}

function respondText(
  response: http.ServerResponse,
  statusCode: number,
  body: string
): void {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function respondHtml(response: http.ServerResponse, body: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Login Successful</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .container { text-align: center; background: white; padding: 40px 60px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    h1 { color: #333; margin-bottom: 10px; }
    p { color: #666; }
    .checkmark { font-size: 48px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✓</div>
    <h1>Login Successful!</h1>
    <p>You can close this window and return to Codex Switcher.</p>
  </div>
</body>
</html>`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
