/**
 * The ONLY file that talks to Project 1 (SessionShield Risk Demonstration).
 * All response parsing/normalization lives here. If Project 1's real response
 * shape differs from the examples, adapt the normalizers below.
 */
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "../config";
import type { DemoSession, RiskInfo, RiskLevel, SecurityEvent } from "../types/security";

export type ApiErrorKind = "offline" | "timeout" | "http" | "parse" | "missing";

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status?: number,
    public body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const isUnreachable = (e: unknown): boolean =>
  e instanceof ApiError && (e.kind === "offline" || e.kind === "timeout");

// ---------------------------------------------------------------- transport

async function rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ApiError("timeout", "Project 1 did not respond in time.");
    }
    throw new ApiError("offline", "Cannot connect to Project 1.");
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await rawRequest(path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError("http", `Project 1 returned HTTP ${res.status} for ${path}.`, res.status, text);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("parse", `Project 1 returned invalid JSON for ${path}.`, res.status, text);
  }
}

// ---------------------------------------------------------------- helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}
const asStr = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function mapLevel(raw: string | undefined): RiskLevel {
  const v = (raw ?? "").trim().toUpperCase();
  if (["LOW", "SAFE", "NORMAL", "SECURE", "SECURED", "NONE"].includes(v)) return "SAFE";
  if (["ELEVATED", "MEDIUM", "MODERATE", "SUSPICIOUS", "WARNING"].includes(v)) return "SUSPICIOUS";
  if (["CRITICAL", "HIGH", "COMPROMISED", "SEVERE"].includes(v)) return "CRITICAL";
  return "UNKNOWN";
}

// ---------------------------------------------------------------- risk

function textOf(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (isObj(v)) return asStr(pick(v, ["message", "description", "reason", "label", "name"]));
  return undefined;
}

function normalizeRisk(data: unknown): RiskInfo {
  if (!isObj(data)) throw new ApiError("parse", "Risk response was not an object.");
  const o = isObj(data.risk) ? data.risk : data;
  const score = asNum(pick(o, ["score", "risk", "riskScore", "risk_score", "total_score"]));
  if (score === undefined) throw new ApiError("missing", "Project 1 did not provide a risk score.");
  const rawLevel = asStr(pick(o, ["level", "riskLevel", "risk_level", "status", "severity"])) ?? "";
  const reasonsRaw = pick(o, ["reasons", "factors", "signals", "details"]);
  const reasons = Array.isArray(reasonsRaw)
    ? reasonsRaw.map(textOf).filter((s): s is string => !!s)
    : [];
  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    rawLevel,
    level: mapLevel(rawLevel),
    reasons,
  };
}

export async function getRisk(): Promise<RiskInfo> {
  return normalizeRisk(await requestJson("/api/security/risk"));
}

// ---------------------------------------------------------------- events

function normalizeEvents(data: unknown): SecurityEvent[] {
  const list = Array.isArray(data)
    ? data
    : isObj(data)
      ? (pick(data, ["events", "items", "data", "timeline"]) as unknown)
      : undefined;
  if (!Array.isArray(list)) throw new ApiError("parse", "Event response was not a list.");
  const out: SecurityEvent[] = [];
  list.forEach((item, i) => {
    if (!isObj(item)) return; // skip malformed entries
    const type = asStr(pick(item, ["type", "eventType", "event_type", "event", "kind", "action"])) ?? "EVENT";
    out.push({
      id: asStr(pick(item, ["id", "eventId", "event_id"])) ?? String(i),
      type,
      message: asStr(pick(item, ["message", "description", "detail", "details", "text"])) ?? type,
      severity: asStr(pick(item, ["severity", "level", "risk"])) ?? "INFO",
      timestamp: asStr(pick(item, ["timestamp", "time", "createdAt", "created_at", "ts", "at"])) ?? "",
    });
  });
  return out;
}

export async function getSecurityEvents(): Promise<SecurityEvent[]> {
  return normalizeEvents(await requestJson("/api/security/events"));
}

// ---------------------------------------------------------------- sessions

function normalizeSession(data: unknown, slot?: "A" | "B"): DemoSession | null {
  if (!isObj(data)) return null;
  const o = isObj(data.session) ? data.session : isObj(data.data) ? data.data : data;
  const sessionId = asStr(pick(o, ["sessionId", "session_id", "id", "sid"]));
  if (!sessionId) return null;
  let user = pick(o, ["userId", "user_id", "username", "user", "owner"]);
  if (isObj(user)) user = pick(user, ["username", "id", "name", "userId"]);
  return {
    sessionId,
    userId: asStr(user) ?? "unknown",
    status: (asStr(pick(o, ["status"])) ?? "").toUpperCase(),
    simulationState: (asStr(pick(o, ["simulationState", "simulation_state", "simState", "state"])) ?? "").toUpperCase(),
    createdAt: asStr(pick(o, ["createdAt", "created_at"])),
    lastActivity: asStr(pick(o, ["lastActivity", "last_activity", "lastSeen", "updatedAt"])),
    browserSlot: slot,
  };
}

export async function getBrowserSession(slot: "A" | "B"): Promise<DemoSession | null> {
  try {
    return normalizeSession(await requestJson(`/api/session/browser/${slot}`), slot);
  } catch (err) {
    // An empty slot is reported as 404 by some backends; that just means "no session".
    if (err instanceof ApiError && err.kind === "http" && err.status === 404) return null;
    throw err;
  }
}

export interface SessionScan {
  browserA: DemoSession | null;
  browserB: DemoSession | null;
  compromised: DemoSession | null;
}

/**
 * Inspects both browser slots. A session is compromised for this demo when
 * status === "ACTIVE" and simulationState === "COMPROMISED". The session ID
 * is always the one Project 1 returned; it is never guessed.
 */
export async function findCompromisedSession(): Promise<SessionScan> {
  const [a, b] = await Promise.allSettled([getBrowserSession("A"), getBrowserSession("B")]);
  for (const r of [a, b]) {
    if (r.status === "rejected" && isUnreachable(r.reason)) throw r.reason;
  }
  const browserA = a.status === "fulfilled" ? a.value : null;
  const browserB = b.status === "fulfilled" ? b.value : null;
  const isBad = (s: DemoSession | null) =>
    !!s && s.status === "ACTIVE" && s.simulationState === "COMPROMISED";
  // Browser B is where the stolen session shows up after the simulated attack.
  const compromised = isBad(browserB) ? browserB : isBad(browserA) ? browserA : null;
  return { browserA, browserB, compromised };
}

// ---------------------------------------------------------------- revoke / connection

export async function revokeSession(sessionId: string): Promise<{ alreadyRevoked: boolean }> {
  if (!sessionId) throw new ApiError("missing", "No compromised session to revoke.");
  const res = await rawRequest("/api/session/revoke", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  const mentionsRevoked = /already|revoked|not active|inactive/i.test(text);
  if (!res.ok) {
    if ([400, 404, 409, 410].includes(res.status) && mentionsRevoked) return { alreadyRevoked: true };
    throw new ApiError("http", `Project 1 refused the revoke request (HTTP ${res.status}).`, res.status, text);
  }
  if (isObj(json) && (json.success === false || json.ok === false)) {
    if (mentionsRevoked) return { alreadyRevoked: true };
    throw new ApiError("http", "Project 1 reported that the revoke failed.", res.status, text);
  }
  const already = isObj(json) && (json.alreadyRevoked === true || /already/i.test(asStr(json.message) ?? ""));
  return { alreadyRevoked: already };
}

export async function checkConnection(): Promise<boolean> {
  try {
    const res = await rawRequest("/api/security/risk");
    return res.ok;
  } catch {
    return false;
  }
}
