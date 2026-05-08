export function query(root, selector) {
  return root.querySelector(selector);
}

export function queryAll(root, selector) {
  return [...root.querySelectorAll(selector)];
}

export function setText(root, selector, value) {
  const element = query(root, selector);

  if (element) {
    element.textContent = value ?? "";
  }
}

export function setTextIfChanged(root, selector, value, options = {}) {
  const element = query(root, selector);

  if (element) {
    setElementTextIfChanged(element, value, options);
  }
}

export function setElementTextIfChanged(element, value, { animate = false } = {}) {
  const nextValue = value ?? "";

  if (element.textContent === nextValue) {
    element.dataset.ready = "1";
    return false;
  }

  const shouldAnimate = animate && element.dataset.ready === "1";

  if (shouldAnimate) {
    element.setAttribute("aria-label", nextValue);
    element.innerHTML = Array.from(nextValue)
      .map((character, index) => {
        const value = character === " " ? "&nbsp;" : escapeHtml(character);
        return `<span class="flip-char" style="--i:${index}">${value}</span>`;
      })
      .join("");
  } else {
    element.textContent = nextValue;
  }

  element.dataset.ready = "1";

  if (shouldAnimate) {
    element.classList.remove("value-flip");
    void element.offsetWidth;
    element.classList.add("value-flip");
  }

  return true;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function refreshIcons() {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons({
      attrs: {
        "aria-hidden": "true",
      },
    });
  }
}

export function downloadTextFile(filename, content, mimeType = "application/json") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
