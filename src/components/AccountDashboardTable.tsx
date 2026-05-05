import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AccountWithUsage } from "../types";
import {
  getQuotaWindowView,
  type QuotaTone,
  type QuotaWindowView,
} from "../lib/quota";

interface AccountDashboardTableProps {
  accounts: AccountWithUsage[];
  onSwitch: (accountId: string) => Promise<void> | void;
  onWarmup: (accountId: string, accountName: string) => Promise<void>;
  onDelete: (accountId: string) => Promise<void> | void;
  onRefresh: (accountId: string) => Promise<void>;
  onRename: (accountId: string, newName: string) => Promise<void>;
  switchingId: string | null;
  switchDisabled: boolean;
  warmingUpId: string | null;
  isWarmingAll: boolean;
  maskedAccounts: Set<string>;
  onToggleMask: (accountId: string) => void;
}

function BlurredText({ children, blur }: { children: ReactNode; blur: boolean }) {
  return (
    <span
      className={`transition-all duration-200 select-none ${blur ? "blur-sm" : ""}`}
      style={blur ? { userSelect: "none" } : undefined}
    >
      {children}
    </span>
  );
}

function planDisplay(account: AccountWithUsage): string {
  if (account.plan_type) {
    return account.plan_type.charAt(0).toUpperCase() + account.plan_type.slice(1);
  }
  return account.auth_mode === "api_key" ? "API Key" : "Unknown";
}

function planClass(account: AccountWithUsage): string {
  const planKey = account.plan_type?.toLowerCase() ?? "api_key";
  const classes: Record<string, string> = {
    pro: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700",
    plus: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700",
    team: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
    enterprise: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
    free: "bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
    api_key: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
  };

  return classes[planKey] ?? classes.free;
}

function toneClass(tone: QuotaTone): string {
  const classes: Record<QuotaTone, string> = {
    good: "text-emerald-700 dark:text-emerald-300",
    warn: "text-amber-700 dark:text-amber-300",
    bad: "text-red-700 dark:text-red-300",
    muted: "text-gray-500 dark:text-gray-400",
  };

  return classes[tone];
}

function barClass(tone: QuotaTone): string {
  const classes: Record<QuotaTone, string> = {
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    muted: "bg-gray-300 dark:bg-gray-700",
  };

  return classes[tone];
}

function QuotaCell({
  view,
  loading,
}: {
  view: QuotaWindowView;
  loading: boolean;
}) {
  if (view.status !== "ok") {
    return (
      <div className="min-w-0 max-w-full">
        <div className={`truncate text-xs font-medium ${toneClass(view.tone)}`} title={view.message || view.remainingLabel}>
          {view.status === "error" ? "Error" : view.remainingLabel}
        </div>
        {view.message && (
          <div className="truncate text-[10px] text-gray-500 dark:text-gray-400" title={view.message}>
            {view.message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-1">
        <span className={`truncate text-xs font-semibold ${toneClass(view.tone)}`} title={view.remainingLabel}>
          {view.remainingLabel}
        </span>
        {loading && (
          <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">...</span>
        )}
      </div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-full transition-all duration-300 ${barClass(view.tone)}`}
          style={{ width: `${view.remainingPercent ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function ResetCell({ view }: { view: QuotaWindowView }) {
  if (view.status === "error") {
    return (
      <div className="truncate text-[11px] text-red-600 dark:text-red-300" title={view.message}>
        {view.message}
      </div>
    );
  }

  if (!view.resetDateTime) {
    return (
      <div className="truncate text-[11px] text-gray-500 dark:text-gray-400" title={view.message || "No reset time"}>
        {view.message || "No reset time"}
      </div>
    );
  }

  return (
    <div title={view.resetTitle}>
      <div className="truncate text-xs font-medium text-gray-900 dark:text-gray-100">
        {view.resetDateTime}
      </div>
      <div
        className={`truncate text-[10px] ${
          view.resetRelative.endsWith("ago")
            ? "text-amber-600 dark:text-amber-300"
            : "text-gray-500 dark:text-gray-400"
        }`}
      >
        {view.resetRelative}
      </div>
    </div>
  );
}

export function AccountDashboardTable({
  accounts,
  onSwitch,
  onWarmup,
  onDelete,
  onRefresh,
  onRename,
  switchingId,
  switchDisabled,
  warmingUpId,
  isWarmingAll,
  maskedAccounts,
  onToggleMask,
}: AccountDashboardTableProps) {
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingId || !inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [editingId]);

  const startRename = (account: AccountWithUsage) => {
    if (maskedAccounts.has(account.id)) return;
    setEditingId(account.id);
    setEditName(account.name);
  };

  const finishRename = async (account: AccountWithUsage) => {
    const trimmed = editName.trim();
    try {
      if (trimmed && trimmed !== account.name) {
        await onRename(account.id, trimmed);
      }
    } catch {
      setEditName(account.name);
    } finally {
      setEditingId(null);
    }
  };

  const handleRefresh = async (accountId: string) => {
    setRefreshingIds((prev) => new Set(prev).add(accountId));
    try {
      await onRefresh(accountId);
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  };

  return (
    <div className="border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="overflow-visible">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[31%]" />
            <col className="w-[12%]" />
            <col className="w-[15%]" />
            <col className="w-[12%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead className="bg-gray-100 text-[10px] uppercase tracking-normal text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <tr>
              <th className="px-1.5 py-1 font-semibold" title="Account name, email, plan, and row actions">Account</th>
              <th className="px-1.5 py-1 font-semibold" title="Remaining quota in the 5 hour window">5H Quota</th>
              <th className="px-1.5 py-1 font-semibold" title="Reset time for the 5 hour quota window">5H Reset</th>
              <th className="px-1.5 py-1 font-semibold" title="Remaining quota in the 1 week window">1W Quota</th>
              <th className="px-1.5 py-1 font-semibold" title="Reset time for the 1 week quota window">1W Reset</th>
              <th className="px-1.5 py-1 text-right font-semibold" title="Switch active Codex account">
                Switch
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-xs dark:divide-gray-800">
            {accounts.map((account) => {
              const masked = maskedAccounts.has(account.id);
              const primary = getQuotaWindowView(account.usage, "primary");
              const secondary = getQuotaWindowView(account.usage, "secondary");
              const rowRefreshing = refreshingIds.has(account.id) || Boolean(account.usageLoading);
              const rowWarming = isWarmingAll || warmingUpId === account.id;
              const switching = switchingId === account.id;

              return (
                <tr
                  key={account.id}
                  className={`transition-colors ${
                    account.is_active
                      ? "bg-emerald-50/70 dark:bg-emerald-950/25"
                      : "bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800/60"
                  }`}
                >
                  <td
                    className={`px-1.5 py-1 align-middle ${
                      account.is_active
                        ? "border-l-2 border-emerald-500"
                        : "border-l-2 border-transparent"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1">
                        {account.is_active && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="Active account" />
                        )}
                        {editingId === account.id ? (
                          <input
                            ref={inputRef}
                            type="text"
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                            onBlur={() => {
                              void finishRename(account);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                              if (event.key === "Escape") {
                                setEditName(account.name);
                                setEditingId(null);
                              }
                            }}
                            className="w-full rounded-sm border border-gray-300 bg-white px-1 py-0.5 text-xs font-semibold text-gray-900 focus:border-gray-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startRename(account)}
                            className="min-w-0 truncate text-left text-xs font-semibold text-gray-900 hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300"
                            title={masked ? undefined : "Rename account"}
                          >
                            <BlurredText blur={masked}>{account.name}</BlurredText>
                          </button>
                        )}
                      </div>

                      {account.email && (
                        <div className="truncate text-[10px] leading-tight text-gray-500 dark:text-gray-400" title={masked ? undefined : account.email}>
                          <BlurredText blur={masked}>{account.email}</BlurredText>
                        </div>
                      )}

                      <div className="mt-0.5 flex items-center gap-0.5 overflow-hidden whitespace-nowrap">
                        <span
                          className={`shrink-0 rounded-sm border px-1 py-0.5 text-[10px] font-medium leading-none ${planClass(account)}`}
                          title={`Plan: ${planDisplay(account)}`}
                        >
                          {planDisplay(account).toUpperCase()}
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggleMask(account.id)}
                          className="shrink-0 rounded-sm border border-gray-200 px-1 py-0.5 text-[10px] leading-none text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                          title={masked ? "Show this account name and email" : "Hide this account name and email"}
                        >
                          {masked ? "Show" : "Hide"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleRefresh(account.id);
                          }}
                          disabled={rowRefreshing}
                          className="shrink-0 rounded-sm border border-gray-200 px-1 py-0.5 text-[10px] leading-none text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                          title={rowRefreshing ? "Refreshing this account quota now" : "Refresh this account quota and metadata"}
                        >
                          {rowRefreshing ? "Refreshing" : "Refresh"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void onWarmup(account.id, account.name);
                          }}
                          disabled={rowWarming}
                          className="shrink-0 rounded-sm border border-amber-200 px-1 py-0.5 text-[10px] leading-none text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/30"
                          title={rowWarming ? "Warm-up request is already running" : "Send minimal warm-up traffic for this account"}
                        >
                          {rowWarming ? "Warming" : "Warm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void onDelete(account.id);
                          }}
                          className="shrink-0 rounded-sm border border-red-200 px-1 py-0.5 text-[10px] leading-none text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/30"
                          title="Delete this account. First click arms confirmation; second click confirms."
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-1.5 py-1 align-middle">
                    <QuotaCell view={primary} loading={rowRefreshing} />
                  </td>
                  <td className="px-1.5 py-1 align-middle">
                    <ResetCell view={primary} />
                  </td>
                  <td className="px-1.5 py-1 align-middle">
                    <QuotaCell view={secondary} loading={rowRefreshing} />
                  </td>
                  <td className="px-1.5 py-1 align-middle">
                    <ResetCell view={secondary} />
                  </td>
                  <td className="px-1.5 py-1 text-right align-middle">
                    <button
                      type="button"
                      onClick={() => {
                        void onSwitch(account.id);
                      }}
                      disabled={account.is_active || switching || switchDisabled}
                      className={`w-full rounded-sm px-1.5 py-1 text-[10px] font-semibold leading-none transition-colors disabled:cursor-default ${
                        account.is_active
                          ? "border border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                          : switchDisabled
                            ? "bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
                            : "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                      }`}
                      title={
                        account.is_active
                          ? "This is the active Codex account"
                          : switching
                            ? "Switching to this account"
                            : switchDisabled
                              ? "Close all Codex processes before switching"
                              : "Switch Codex to this account"
                      }
                    >
                      {account.is_active
                        ? "ACTIVE"
                        : switching
                          ? "..."
                          : switchDisabled
                            ? "RUNNING"
                            : "SWITCH"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
