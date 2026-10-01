export type RiskLevel =
  | "SAFE"
  | "SUSPICIOUS"
  | "CRITICAL"
  | "UNKNOWN"
  | "OFFLINE"
  | "SECURED";

export interface SecurityEvent {
  id: string;
  type: string;
  message: string;
  severity: string;
  timestamp: string;
}

export interface DemoSession {
  sessionId: string;
  userId: string;
  status: string;
  simulationState: string;
  createdAt?: string;
  lastActivity?: string;
  browserSlot?: "A" | "B";
}

export interface RiskInfo {
  /** 0-100, exactly as reported by Project 1 (clamped). */
  score: number;
  /** Level string exactly as reported by Project 1 (may be empty). */
  rawLevel: string;
  /** Normalized level. */
  level: RiskLevel;
  reasons: string[];
}

export interface Settings {
  notificationsEnabled: boolean;
  riskThreshold: number;
  refreshSeconds: number;
  darkMode: boolean;
}

export interface Snapshot {
  state: RiskLevel;
  /** Only present when Project 1 actually reported a score. */
  score?: number;
  rawLevel?: string;
  reasons: string[];
  events: SecurityEvent[];
  compromised: DemoSession | null;
  browserA: DemoSession | null;
  browserB: DemoSession | null;
  lastChecked: string;
  /** User-friendly error, if the check could not complete normally. */
  error?: string;
}
