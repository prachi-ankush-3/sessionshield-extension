import { DEFAULT_POLL_SECONDS, NOTIFICATION_ID, POLL_ALARM } from "../config";
import { runCheck } from "../services/monitor";
import { getSettings } from "../utils/storage";

async function schedule(force = false): Promise<void> {
  const { refreshSeconds } = await getSettings();
  const periodInMinutes = Math.max(DEFAULT_POLL_SECONDS, refreshSeconds) / 60;
  const existing = await chrome.alarms.get(POLL_ALARM);
  if (!force && existing && existing.periodInMinutes === periodInMinutes) return;
  await chrome.alarms.create(POLL_ALARM, { delayInMinutes: periodInMinutes, periodInMinutes });
}

const safeCheck = () => runCheck().catch((e) => console.error("[SessionShield] check error", e));

chrome.runtime.onInstalled.addListener(async () => {
  await schedule(true);
  await safeCheck();
});

chrome.runtime.onStartup.addListener(async () => {
  await schedule();
  await safeCheck();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void safeCheck();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.refreshSeconds) void schedule(true);
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (id !== NOTIFICATION_ID) return;
  chrome.notifications.clear(id);
  try {
    await chrome.action.openPopup(); // not available in every Chrome version
  } catch {
    /* user can click the toolbar icon */
  }
});

// Make sure the alarm exists whenever the service worker wakes up.
void schedule();
