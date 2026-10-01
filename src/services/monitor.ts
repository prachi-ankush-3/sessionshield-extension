/**
 * Shared monitoring logic used by BOTH the background service worker and
 * the popup. Fetch -> detect -> compare with previous state -> save ->
 * badge -> notify.
 */
import { NOTIFICATION_ID } from "../config";
import type { RiskLevel, SecurityEvent, Snapshot } from "../types/security";
import { getSettings, getState, removeState, saveState } from "../utils/storage";
import {
  ApiError,
  findCompromisedSession,
  getRisk,
  getSecurityEvents,
  isUnreachable,
  revokeSession,
  type SessionScan,
} from "./api";

const RANK: Partial<Record<RiskLevel, number>> = { SAFE: 0, SECURED: 0, SUSPICIOUS: 1, CRITICAL: 2 };
const MAX_EVENTS = 8;

// ---------------------------------------------------------------- events

export interface EventView {
  icon: string;
  label: string;
  text: string;
  important: boolean;
}

export function describeEvent(e: SecurityEvent): EventView {
  const hay = `${e.type} ${e.message}`.toUpperCase();
  if (hay.includes("REVOK")) return { icon: "🔒", label: "Revoked", text: e.message, important: true };
  if (hay.includes("IDENTITY")) return { icon: "🚨", label: "Identity", text: e.message, important: true };
  if (hay.includes("REUSE")) return { icon: "🚨", label: "Reuse", text: e.message, important: true };
  if (hay.includes("COMPROMIS")) return { icon: "⚠", label: "Compromised", text: e.message, important: true };
  if (hay.includes("RISK")) return { icon: "⚠", label: "Risk", text: e.message, important: true };
  if (hay.includes("LOGIN") || hay.includes("LOGGED")) return { icon: "✓", label: "Login", text: e.message, important: false };
  return { icon: "•", label: "Event", text: e.message, important: false };
}

function recentEvents(events: SecurityEvent[]): SecurityEvent[] {
  const withTime = events.map((e, i) => ({ e, i, t: Date.parse(e.timestamp) }));
  const sortable = withTime.every((x) => Number.isFinite(x.t));
  const ordered = sortable ? [...withTime].sort((a, b) => a.t - b.t || a.i - b.i) : withTime;
  return ordered.slice(-MAX_EVENTS).map((x) => x.e);
}

// ---------------------------------------------------------------- badge & notification

export async function updateBadge(state: RiskLevel): Promise<void> {
  try {
    switch (state) {
      case "SUSPICIOUS":
        await chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
        await chrome.action.setBadgeText({ text: "!" });
        break;
      case "CRITICAL":
        await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
        await chrome.action.setBadgeText({ text: "!" });
        break;
      case "OFFLINE":
        await chrome.action.setBadgeBackgroundColor({ color: "#64748b" });
        await chrome.action.setBadgeText({ text: "×" });
        break;
      default: // SAFE, SECURED, UNKNOWN
        await chrome.action.setBadgeText({ text: "" });
    }
  } catch (err) {
    console.warn("[SessionShield] badge update failed", err);
  }
}

async function notify(state: "SUSPICIOUS" | "CRITICAL"): Promise<void> {
  const critical = state === "CRITICAL";
  try {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: critical ? "🚨 SessionShield Security Alert" : "⚠️ SessionShield Warning",
      message: critical
        ? "Possible session compromise detected.\nOpen SessionShield and force logout immediately."
        : "Suspicious session activity detected.\nReview your security status.",
      priority: critical ? 2 : 1,
      requireInteraction: critical,
    });
  } catch (err) {
    console.warn("[SessionShield] notification failed", err);
  }
}

// ---------------------------------------------------------------- main check

export async function runCheck(opts: { notify?: boolean } = {}): Promise<Snapshot> {
  const [settings, stored] = await Promise.all([getSettings(), getState()]);
  const lastChecked = new Date().toISOString();
  let snap: Snapshot;

  try {
    const risk = await getRisk(); // throws offline / http / parse / missing
    const [events, scan] = await Promise.all([
      getSecurityEvents().catch((e) => {
        console.warn("[SessionShield] could not load events", e);
        return [] as SecurityEvent[];
      }),
      findCompromisedSession().catch((e): SessionScan => {
        console.warn("[SessionShield] could not inspect browser sessions", e);
        return { browserA: null, browserB: null, compromised: null };
      }),
    ]);

    let state: RiskLevel = risk.level;
    if (state === "SUSPICIOUS" && risk.score >= settings.riskThreshold) state = "CRITICAL";

    // A new compromised session after a previous revoke invalidates "secured".
    let secured = !!stored.secured;
    if (secured && scan.compromised && scan.compromised.sessionId !== stored.securedSessionId) {
      secured = false;
      await removeState(["secured", "securedSessionId"]);
    }
    if (secured) {
      if (state === "SAFE") {
        secured = false;
        await removeState(["secured", "securedSessionId"]);
      } else if (!scan.compromised) {
        state = "SECURED";
      }
    }

    snap = {
      state,
      score: risk.score,
      rawLevel: risk.rawLevel,
      reasons: risk.reasons,
      events: recentEvents(events),
      compromised: scan.compromised,
      browserA: scan.browserA,
      browserB: scan.browserB,
      lastChecked,
      error: state === "UNKNOWN" ? "Project 1 did not report a recognizable risk level." : undefined,
    };
  } catch (err) {
    const unreachable = isUnreachable(err);
    if (!unreachable) console.error("[SessionShield] check failed", err);
    snap = {
      state: unreachable ? "OFFLINE" : "UNKNOWN",
      reasons: [],
      events: [],
      compromised: null,
      browserA: null,
      browserB: null,
      lastChecked,
      error: unreachable
        ? "SessionShield cannot connect to the SessionShield Risk Demonstration backend."
        : err instanceof ApiError
          ? err.message
          : "Unexpected error while checking security status.",
    };
  }

  // Notification decision uses the previous persisted state.
  const prevRank = RANK[stored.lastRiskLevel ?? "SAFE"] ?? 0;
  const nowRank = RANK[snap.state];
  const shouldNotify =
    opts.notify !== false &&
    settings.notificationsEnabled &&
    (snap.state === "SUSPICIOUS" || snap.state === "CRITICAL") &&
    nowRank !== undefined &&
    nowRank > prevRank;

  const patch: Parameters<typeof saveState>[0] = {
    riskLevel: snap.state,
    lastChecked,
    compromisedSessionId: snap.compromised?.sessionId,
  };
  if (snap.score !== undefined) patch.riskScore = snap.score;
  // Keep the last real level while offline so reconnecting doesn't re-notify.
  if (snap.state !== "OFFLINE" && snap.state !== "UNKNOWN") patch.lastRiskLevel = snap.state;
  await saveState(patch);
  if (snap.score === undefined) await removeState(["riskScore"]);
  if (!snap.compromised) await removeState(["compromisedSessionId"]);

  await updateBadge(snap.state);
  if (shouldNotify) await notify(snap.state as "SUSPICIOUS" | "CRITICAL");
  if (snap.state === "SAFE" || snap.state === "SECURED") {
    try { await chrome.notifications.clear(NOTIFICATION_ID); } catch { /* ignore */ }
  }
  return snap;
}

// ---------------------------------------------------------------- force logout

export interface ForceLogoutResult {
  ok: boolean;
  alreadyRevoked: boolean;
  message?: string;
  snapshot?: Snapshot;
}

export async function forceLogout(sessionId: string): Promise<ForceLogoutResult> {
  try {
    const { alreadyRevoked } = await revokeSession(sessionId);
    await saveState({ secured: true, securedSessionId: sessionId });
    try { await chrome.notifications.clear(NOTIFICATION_ID); } catch { /* ignore */ }
    await chrome.action.setBadgeText({ text: "" });

    const snapshot = await runCheck({ notify: false });
    // Verify with Project 1 that the session is really gone.
    if (snapshot.compromised?.sessionId === sessionId) {
      await removeState(["secured", "securedSessionId"]);
      return {
        ok: false,
        alreadyRevoked: false,
        snapshot,
        message: "Project 1 still reports that session as active. Please try again.",
      };
    }
    return { ok: true, alreadyRevoked, snapshot };
  } catch (err) {
    console.error("[SessionShield] force logout failed", err);
    return {
      ok: false,
      alreadyRevoked: false,
      message: isUnreachable(err)
        ? "Cannot reach Project 1. Make sure it is running and try again."
        : err instanceof ApiError
          ? err.message
          : "Force logout failed unexpectedly.",
    };
  }
}
