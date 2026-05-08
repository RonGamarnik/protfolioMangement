const templateCache = new Map();

export async function loadTemplate(url) {
  const key = url instanceof URL ? url.href : String(url);

  if (templateCache.has(key)) {
    return templateCache.get(key);
  }

  const response = await fetch(key, { cache: "no-cache" });

  if (!response.ok) {
    throw new Error(`Template load failed: ${key}`);
  }

  const template = await response.text();
  templateCache.set(key, template);
  return template;
}

export function renderTemplate(template, data = {}) {
  return template.replace(/{{\s*([\w.-]+)\s*}}/g, (_, path) => {
    const value = path.split(".").reduce((current, key) => current?.[key], data);
    return escapeHtml(value ?? "");
  });
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
