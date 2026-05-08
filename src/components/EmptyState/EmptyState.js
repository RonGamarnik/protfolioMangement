import { loadTemplate } from "../../lib/template.js";

export async function renderEmptyState(container) {
  const template = await loadTemplate(new URL("./EmptyState.html", import.meta.url));
  container.innerHTML = template;
}
