import { loadTemplate } from "../../lib/template.js";
import { query, setText } from "../../lib/dom.js";

export async function renderSettingsPanel(container, state, actions) {
  const template = await loadTemplate(new URL("./SettingsPanel.html", import.meta.url));
  container.innerHTML = template;

  const autoRefreshInput = query(container, '[data-field="auto-refresh"]');
  const refreshSecondsSelect = query(container, '[data-field="refresh-seconds"]');
  const themeToggle = query(container, '[data-field="theme-toggle"]');
  const closeButton = query(container, '[data-action="close-settings"]');

  autoRefreshInput.checked = Boolean(state.settings.autoRefresh);
  refreshSecondsSelect.value = String(state.settings.refreshSeconds);
  themeToggle.checked = state.settings.theme !== "light";

  setText(
    container,
    '[data-field="auto-label"]',
    state.settings.autoRefresh ? "פעיל" : "כבוי",
  );
  setText(
    container,
    '[data-field="theme-label"]',
    state.settings.theme === "light" ? "בהיר" : "כהה",
  );

  autoRefreshInput.addEventListener("change", () => {
    actions.updateSettings({ autoRefresh: autoRefreshInput.checked });
  });

  refreshSecondsSelect.addEventListener("change", () => {
    actions.updateSettings({ refreshSeconds: Number(refreshSecondsSelect.value) });
  });

  themeToggle.addEventListener("change", () => {
    actions.updateSettings({ theme: themeToggle.checked ? "dark" : "light" });
  });

  closeButton.addEventListener("click", () => {
    actions.closeSettings();
  });
}
