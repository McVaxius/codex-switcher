import type { UsageInfo } from "../types";

export type QuotaWindowKind = "primary" | "secondary";
export type QuotaWindowStatus = "loading" | "ok" | "empty" | "error";
export type QuotaTone = "good" | "warn" | "bad" | "muted";

export interface QuotaWindowView {
  status: QuotaWindowStatus;
  label: "5H" | "1W";
  remainingPercent: number | null;
  remainingLabel: string;
  resetDateTime: string;
  resetRelative: string;
  resetTitle: string;
  message: string;
  tone: QuotaTone;
}

const WINDOW_LABELS: Record<QuotaWindowKind, "5H" | "1W"> = {
  primary: "5H",
  secondary: "1W",
};

export function getQuotaWindowView(
  usage: UsageInfo | undefined,
  window: QuotaWindowKind
): QuotaWindowView {
  const label = WINDOW_LABELS[window];

  if (!usage) {
    return emptyView(label, "Loading usage...", "loading");
  }

  if (usage.error) {
    return {
      ...emptyView(label, usage.error, "error"),
      tone: "bad",
    };
  }

  const usedPercent =
    window === "primary"
      ? usage.primary_used_percent
      : usage.secondary_used_percent;
  const resetAt =
    window === "primary" ? usage.primary_resets_at : usage.secondary_resets_at;

  if (usedPercent === null || usedPercent === undefined) {
    return emptyView(label, `No ${label} quota data`, "empty");
  }

  const remainingPercent = clampPercent(100 - usedPercent);
  const reset = formatReset(resetAt);

  return {
    status: "ok",
    label,
    remainingPercent,
    remainingLabel: `${formatPercent(remainingPercent)} left`,
    resetDateTime: reset.dateTime,
    resetRelative: reset.relative,
    resetTitle: reset.title,
    message: reset.dateTime ? "" : "No reset time",
    tone: toneForRemaining(remainingPercent),
  };
}

function emptyView(
  label: "5H" | "1W",
  message: string,
  status: QuotaWindowStatus
): QuotaWindowView {
  return {
    status,
    label,
    remainingPercent: null,
    remainingLabel: message,
    resetDateTime: "",
    resetRelative: "",
    resetTitle: message,
    message,
    tone: "muted",
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function formatPercent(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.05) {
    return `${rounded}%`;
  }
  return `${value.toFixed(1)}%`;
}

function toneForRemaining(remainingPercent: number): QuotaTone {
  if (remainingPercent <= 10) return "bad";
  if (remainingPercent <= 30) return "warn";
  return "good";
}

function formatReset(resetAt: number | null | undefined): {
  dateTime: string;
  relative: string;
  title: string;
} {
  if (resetAt === null || resetAt === undefined) {
    return {
      dateTime: "",
      relative: "",
      title: "No reset time",
    };
  }

  const resetDate = new Date(resetAt * 1000);
  if (Number.isNaN(resetDate.getTime())) {
    return {
      dateTime: "",
      relative: "",
      title: "Invalid reset time",
    };
  }

  const dateTime = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(resetDate);

  const diffMs = resetDate.getTime() - Date.now();
  const duration = formatDurationCompact(Math.abs(diffMs));
  const relative =
    Math.abs(diffMs) < 60_000
      ? "now"
      : diffMs > 0
        ? `in ${duration}`
        : `${duration} ago`;

  return {
    dateTime,
    relative,
    title: resetDate.toString(),
  };
}

function formatDurationCompact(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  if (days < 7) return `${days}d ${hours % 24}h`;
  return `${weeks}w ${days % 7}d`;
}
