import { DEFAULT_POLL_SECONDS } from "../config";
import type { RiskLevel, Settings } from "../types/security";

/**
 * Only non-sensitive monitoring state is stored. Never passwords, real
 * cookies, real tokens or website credentials.
 */
export interface StoredState {
  riskScore?: number;
  riskLevel?: RiskLevel;
  lastRiskLevel?: RiskLevel;
  lastChecked?: string;
  compromisedSessionId?: string;
  /** Set after a successful force logout, cleared when a new compromise appears. */
  secured?: boolean;
  securedSessionId?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: true,
  riskThreshold: 60,
  refreshSeconds: DEFAULT_POLL_SECONDS,
  darkMode: true,
};

export async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS))) as Partial<Settings>;
  const s = { ...DEFAULT_SETTINGS, ...stored };
  s.riskThreshold = Math.min(100, Math.max(10, Number(s.riskThreshold) || DEFAULT_SETTINGS.riskThreshold));
  s.refreshSeconds = Math.max(DEFAULT_POLL_SECONDS, Number(s.refreshSeconds) || DEFAULT_POLL_SECONDS);
  return s;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export async function getState(): Promise<StoredState> {
  return (await chrome.storage.local.get([
    "riskScore",
    "riskLevel",
    "lastRiskLevel",
    "lastChecked",
    "compromisedSessionId",
    "secured",
    "securedSessionId",
  ])) as StoredState;
}

export async function saveState(patch: Partial<StoredState>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export async function removeState(keys: (keyof StoredState)[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}
