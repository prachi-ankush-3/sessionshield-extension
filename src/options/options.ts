import { getSettings, saveSettings } from "../utils/storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const notifications = $<HTMLInputElement>("notifications");
const threshold = $<HTMLInputElement>("threshold");
const thresholdMsg = $("threshold-msg");
const refresh = $<HTMLSelectElement>("refresh");
const dark = $<HTMLInputElement>("dark");
const saved = $("saved");

let timer: number | undefined;
function showSaved(): void {
  saved.textContent = "Settings saved.";
  window.clearTimeout(timer);
  timer = window.setTimeout(() => (saved.textContent = ""), 1800);
}

(async () => {
  const s = await getSettings();
  notifications.checked = s.notificationsEnabled;
  threshold.value = String(s.riskThreshold);
  refresh.value = String(s.refreshSeconds);
  if (refresh.value !== String(s.refreshSeconds)) refresh.value = "30";
  dark.checked = s.darkMode;
  document.documentElement.classList.toggle("light", !s.darkMode);
})();

notifications.addEventListener("change", async () => {
  await saveSettings({ notificationsEnabled: notifications.checked });
  showSaved();
});

threshold.addEventListener("change", async () => {
  const n = Number(threshold.value);
  if (!Number.isInteger(n) || n < 10 || n > 100) {
    thresholdMsg.textContent = "Enter a whole number from 10 to 100.";
    thresholdMsg.classList.add("err");
    return;
  }
  thresholdMsg.textContent = "";
  thresholdMsg.classList.remove("err");
  await saveSettings({ riskThreshold: n });
  showSaved();
});

refresh.addEventListener("change", async () => {
  await saveSettings({ refreshSeconds: Number(refresh.value) });
  showSaved();
});

dark.addEventListener("change", async () => {
  document.documentElement.classList.toggle("light", !dark.checked);
  await saveSettings({ darkMode: dark.checked });
  showSaved();
});
