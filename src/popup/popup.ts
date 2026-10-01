import { API_BASE_URL } from "../config";
import { describeEvent, forceLogout, runCheck } from "../services/monitor";
import type { DemoSession, Snapshot } from "../types/security";
import { getSettings } from "../utils/storage";

const app = document.getElementById("app") as HTMLElement;

let snap: Snapshot | null = null;
let busy = false;
let confirming = false;
let flash: { kind: "ok" | "err"; text: string } | null = null;
let securedNote = "The compromised session has been revoked.";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

function relTime(iso?: string): string {
  if (!iso) return "Unknown";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return "Just now";
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleTimeString();
}

function maskId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 12)}…${id.slice(-3)}` : id;
}

function sessionCard(title: string, s: DemoSession): string {
  return `
    <section class="card" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      <dl class="kv">
        <dt>Owner</dt><dd>${esc(cap(s.userId))}</dd>
        ${s.browserSlot ? `<dt>Browser</dt><dd>${s.browserSlot}</dd>` : ""}
        <dt>Status</dt><dd>${esc(cap(s.status.toLowerCase()) || "Unknown")}</dd>
        ${s.simulationState ? `<dt>State</dt><dd>${esc(s.simulationState)}</dd>` : ""}
        <dt>Last activity</dt><dd>${esc(relTime(s.lastActivity))}</dd>
        <dt>Session</dt><dd><code>${esc(maskId(s.sessionId))}</code></dd>
      </dl>
    </section>`;
}

function timeline(s: Snapshot): string {
  if (!s.events.length) return "";
  const items = s.events
    .map((e) => {
      const v = describeEvent(e);
      return `<li class="${v.important ? "imp" : ""}"><span class="i" aria-hidden="true">${v.icon}</span><span><span class="sr-only">${esc(v.label)}: </span>${esc(v.text)}</span></li>`;
    })
    .join("");
  return `<section class="card" aria-label="Security timeline"><h3>Security Timeline</h3><ul>${items}</ul></section>`;
}

function whatHappened(s: Snapshot): string {
  const fromEvents = s.events
    .map(describeEvent)
    .filter((v) => v.important && v.label !== "Revoked")
    .map((v) => v.text);
  const list = [...new Set([...s.reasons, ...fromEvents])].slice(0, 4);
  if (!list.length) return "";
  return `<section class="card" aria-label="What happened"><h3>What happened?</h3><ul>${list
    .map((t) => `<li><span class="i" aria-hidden="true">•</span><span>${esc(t)}</span></li>`)
    .join("")}</ul></section>`;
}

function hero(s: Snapshot): string {
  const score = s.score !== undefined ? `<div class="score">${s.score} / 100</div>` : "";
  const level = s.rawLevel ? `<div class="level">${esc(s.rawLevel.toUpperCase())}</div>` : "";
  switch (s.state) {
    case "SAFE":
      return `<div class="hero safe"><div class="icon" aria-hidden="true">🟢</div><h2>SECURE</h2>${score}${level}<p>No suspicious session activity detected.</p></div>`;
    case "SUSPICIOUS":
      return `<div class="hero suspicious"><div class="icon" aria-hidden="true">⚠️</div><h2>SUSPICIOUS ACTIVITY</h2>${score}${level}<p>Suspicious session activity has been detected. Review the security events.</p></div>`;
    case "CRITICAL":
      return `<div class="hero critical" role="alert"><div class="icon" aria-hidden="true">🚨</div><h2>POSSIBLE SESSION COMPROMISE</h2>${score}${level || '<div class="level">CRITICAL</div>'}</div>`;
    case "SECURED":
      return `<div class="hero secured"><div class="icon" aria-hidden="true">✅</div><h2>ACCOUNT SECURED</h2><p>${esc(securedNote)}</p><p>The simulated session can no longer be used.</p></div>`;
    case "OFFLINE":
      return `<div class="hero offline" role="alert"><div class="icon" aria-hidden="true">🔴</div><h2>BACKEND OFFLINE</h2><p>SessionShield cannot connect to:</p><p><code>${esc(API_BASE_URL)}</code></p><p>Make sure Project 1 (SessionShield Risk Demonstration) is running, then try again.</p></div>`;
    default:
      return `<div class="hero"><div class="icon" aria-hidden="true">❔</div><h2>STATUS UNKNOWN</h2>${score}<p>${esc(s.error ?? "Could not determine the security status.")}</p></div>`;
  }
}

function render(): void {
  if (!snap) {
    app.innerHTML = `<p class="muted center" style="padding:24px">Checking security status…</p>`;
    return;
  }
  const s = snap;
  const parts: string[] = [];
  parts.push(`<header class="top"><span class="logo" aria-hidden="true">🛡</span><div><h1>SessionShield</h1><p>Security Monitor · educational simulation</p></div><a href="#" id="opts">Settings</a></header>`);
  parts.push(`<div class="body">`);
  if (flash) parts.push(`<div class="flash ${flash.kind}" role="status">${esc(flash.text)}</div>`);
  parts.push(hero(s));

  const canForce = !!s.compromised && (s.state === "CRITICAL" || s.state === "SUSPICIOUS");
  if (s.state === "CRITICAL") parts.push(whatHappened(s));
  if (s.compromised && s.state !== "OFFLINE") parts.push(sessionCard("Compromised Demo Session", s.compromised));
  else if (s.state === "SAFE" && (s.browserA ?? s.browserB)) parts.push(sessionCard("Current Demo Session", (s.browserA ?? s.browserB) as DemoSession));

  if (canForce) {
    parts.push(`<div><button class="btn danger" id="force" ${busy ? "disabled" : ""}>🚨 FORCE LOGOUT</button><p class="hint">Revoke the compromised demo session immediately.</p></div>`);
  } else if (s.state === "SUSPICIOUS") {
    parts.push(`<button class="btn primary" id="review">Review Security</button>`);
  } else if (s.state === "CRITICAL") {
    parts.push(`<p class="hint">Project 1 reports a critical risk but no compromised session could be identified in Browser A/B. Review Project 1.</p><button class="btn primary" id="review">Review Security</button>`);
  }

  if (s.state !== "OFFLINE") parts.push(timeline(s));
  parts.push(`</div>`);

  parts.push(`<footer class="foot"><div class="row"><small>Last checked: ${esc(relTime(s.lastChecked))}</small><button class="btn" id="refresh" ${busy ? "disabled" : ""}>${s.state === "OFFLINE" ? "Retry" : "Refresh"}</button></div><small>Simulation only. No real cookies, tokens or credentials are accessed.</small></footer>`);

  if (confirming && s.compromised) {
    parts.push(`<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-desc"><h2 id="dlg-title">FORCE LOGOUT?</h2><p id="dlg-desc">A compromised SessionShield demo session has been detected. Forcing logout will immediately revoke that session.</p><div class="actions"><button class="btn" id="cancel">Cancel</button><button class="btn danger" id="confirm">Force Logout</button></div></div></div>`);
  }

  app.innerHTML = parts.join("");
  bind();
  if (confirming) (document.getElementById("cancel") as HTMLButtonElement | null)?.focus();
}

function bind(): void {
  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener("click", (e) => { e.preventDefault(); fn(); });
  on("refresh", () => void refresh());
  on("review", () => void chrome.tabs.create({ url: API_BASE_URL }));
  on("opts", () => void chrome.runtime.openOptionsPage());
  on("force", () => { confirming = true; flash = null; render(); });
  on("cancel", () => { confirming = false; render(); });
  on("confirm", () => void doForceLogout());
}

async function refresh(): Promise<void> {
  busy = true;
  render();
  try {
    snap = await runCheck();
  } finally {
    busy = false;
    render();
  }
}

async function doForceLogout(): Promise<void> {
  const id = snap?.compromised?.sessionId;
  confirming = false;
  if (!id) { render(); return; }
  busy = true;
  render();
  const result = await forceLogout(id);
  busy = false;
  if (result.snapshot) snap = result.snapshot;
  if (result.ok) {
    securedNote = result.alreadyRevoked
      ? "The compromised session has already been revoked."
      : "The compromised session has been revoked.";
    flash = null;
  } else {
    flash = { kind: "err", text: result.message ?? "Force logout failed." };
  }
  render();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && confirming) { confirming = false; render(); }
});

(async () => {
  const settings = await getSettings();
  document.documentElement.classList.toggle("light", !settings.darkMode);
  render();
  await refresh();
})();
