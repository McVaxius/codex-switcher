import { describe, expect, it } from "vitest";
import {
  AUTH_MODE_API_KEY,
  type AccountsStore,
  parseChatGptIdTokenClaims,
} from "../../src-node/types";
import {
  exportAccountsFullEncryptedBytes,
  exportAccountsSlimText,
  importAccountsFullEncryptedBytes,
  importAccountsSlimText,
} from "../../src-node/backup";

function apiKeyStore(): AccountsStore {
  const created = "2026-01-01T00:00:00.000Z";
  return {
    version: 1,
    active_account_id: "acc-1",
    masked_account_ids: ["acc-1"],
    accounts: [
      {
        id: "acc-1",
        name: "Work",
        email: null,
        plan_type: null,
        subscription_expires_at: null,
        auth_mode: AUTH_MODE_API_KEY,
        auth_data: { type: AUTH_MODE_API_KEY, key: "sk-test" },
        created_at: created,
        last_used_at: null,
      },
    ],
  };
}

describe("Node backend compatibility helpers", () => {
  it("parses ChatGPT id token claims", () => {
    const payload = Buffer.from(
      JSON.stringify({
        email: "user@example.com",
        "https://api.openai.com/auth": {
          chatgpt_plan_type: "plus",
          chatgpt_account_id: "acc_123",
          chatgpt_subscription_active_until: "2026-04-23T05:03:38+00:00",
        },
      })
    ).toString("base64url");

    const claims = parseChatGptIdTokenClaims(`header.${payload}.signature`);

    expect(claims.email).toBe("user@example.com");
    expect(claims.plan_type).toBe("plus");
    expect(claims.account_id).toBe("acc_123");
    expect(claims.subscription_expires_at).toBe("2026-04-23T05:03:38.000Z");
  });

  it("round trips slim api-key exports", async () => {
    const payload = exportAccountsSlimText(apiKeyStore());
    const { store, summary } = await importAccountsSlimText(
      { version: 1, accounts: [], active_account_id: null, masked_account_ids: [] },
      payload
    );

    expect(payload.startsWith("css1.")).toBe(true);
    expect(summary).toMatchObject({
      total_in_payload: 1,
      imported_count: 1,
      skipped_count: 0,
    });
    expect(store.accounts[0].name).toBe("Work");
    expect(store.accounts[0].auth_data).toMatchObject({ key: "sk-test" });
  });

  it("round trips full encrypted exports", () => {
    const encrypted = exportAccountsFullEncryptedBytes(apiKeyStore());
    const { store, summary } = importAccountsFullEncryptedBytes(
      { version: 1, accounts: [], active_account_id: null, masked_account_ids: [] },
      encrypted
    );

    expect(encrypted.subarray(0, 4).toString("ascii")).toBe("CSWF");
    expect(summary.imported_count).toBe(1);
    expect(store.accounts[0].auth_data).toMatchObject({ key: "sk-test" });
  });
});
