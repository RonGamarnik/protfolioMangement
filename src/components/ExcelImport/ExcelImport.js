import { query } from "../../lib/dom.js";
import { formatCurrency, formatNumber } from "../../lib/formatters.js";
import { escapeHtml, loadTemplate } from "../../lib/template.js";
import { parseExcelPortfolioPaste } from "../../services/excelImportService.js";

const PREVIEW_LIMIT = 12;

export async function createExcelImport(container, actions) {
  const template = await loadTemplate(new URL("./ExcelImport.html", import.meta.url));
  container.innerHTML = template;

  const form = query(container, '[data-field="form"]');
  const pasteInput = query(container, '[data-field="paste"]');
  const status = query(container, '[data-field="status"]');
  const preview = query(container, '[data-field="preview"]');
  const previewRows = query(container, '[data-field="preview-rows"]');
  const previewMore = query(container, '[data-field="preview-more"]');
  const errors = query(container, '[data-field="errors"]');
  const submitButton = query(container, '[data-field="submit"]');
  const clearButton = query(container, '[data-action="clear-paste"]');
  const closeButton = query(container, '[data-action="close-excel-import-panel"]');
  const state = {
    parsed: {
      rows: [],
      errors: [],
    },
  };

  pasteInput.addEventListener("input", renderPreview);

  pasteInput.addEventListener("paste", () => {
    window.requestAnimationFrame(renderPreview);
  });

  clearButton.addEventListener("click", () => {
    reset();
    pasteInput.focus();
  });

  closeButton.addEventListener("click", () => {
    actions.closeExcelImport?.();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.parsed.rows.length) {
      pasteInput.focus();
      return;
    }

    submitButton.disabled = true;

    try {
      await actions.applyExcelImport({
        rows: state.parsed.rows,
      });
    } finally {
      submitButton.disabled = false;
    }
  });

  renderPreview();

  function renderPreview() {
    state.parsed = parseExcelPortfolioPaste(pasteInput.value);
    const { rows, errors: parsedErrors } = state.parsed;
    const hasText = pasteInput.value.trim().length > 0;

    status.textContent = hasText
      ? `${rows.length} שורות מוכנות${parsedErrors.length ? `, ${parsedErrors.length} שגיאות` : ""}`
      : "אין נתונים";
    submitButton.disabled = rows.length === 0;
    preview.hidden = rows.length === 0;
    errors.hidden = parsedErrors.length === 0;

    previewRows.innerHTML = rows.slice(0, PREVIEW_LIMIT).map(renderRow).join("");

    const hiddenRowsCount = Math.max(0, rows.length - PREVIEW_LIMIT);
    previewMore.hidden = hiddenRowsCount === 0;
    previewMore.textContent = hiddenRowsCount ? `ועוד ${hiddenRowsCount} שורות` : "";

    errors.innerHTML = parsedErrors.length
      ? parsedErrors
          .slice(0, 6)
          .map((error) => `<p>שורה ${error.lineNumber}: ${escapeHtml(error.message)}</p>`)
          .join("")
      : "";

    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }
  }

  function reset() {
    pasteInput.value = "";
    renderPreview();
  }

  function focusPaste() {
    window.setTimeout(() => {
      pasteInput.focus();
    }, 0);
  }

  return {
    reset,
    focusPaste,
  };
}

function renderRow(row) {
  const amount = row.price * row.quantity;

  return `
    <tr>
      <td>${escapeHtml(row.name || "--")}</td>
      <td><strong>${escapeHtml(row.symbol)}</strong></td>
      <td>${escapeHtml(row.currency)}</td>
      <td class="number-cell">${escapeHtml(formatCurrency(row.price, row.currency))}</td>
      <td class="number-cell">${escapeHtml(formatNumber(row.quantity, 6))}</td>
      <td class="number-cell">${escapeHtml(formatCurrency(amount, row.currency))}</td>
    </tr>
  `;
}
