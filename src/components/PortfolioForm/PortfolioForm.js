import { loadTemplate } from "../../lib/template.js";
import { query, setText } from "../../lib/dom.js";
import { formatNumber } from "../../lib/formatters.js";

export async function createPortfolioForm(container, actions) {
  const template = await loadTemplate(new URL("./PortfolioForm.html", import.meta.url));
  container.innerHTML = template;

  const panel = query(container, ".portfolio-form");
  const form = query(container, '[data-field="form"]');
  const resetButton = query(container, '[data-action="reset"]');
  const currentPriceButton = query(container, '[data-action="use-current-price"]');
  const state = {
    editingId: null,
    buyCurrency: "USD",
  };

  form.addEventListener("input", updateSharePreview);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = readForm();
    await actions.submitHolding(data);
  });

  resetButton.addEventListener("click", () => {
    actions.closeHoldingForm?.();
  });

  currentPriceButton.addEventListener("click", async () => {
    const symbol = form.elements.symbol.value.trim();

    if (!symbol) {
      form.elements.symbol.focus();
      return;
    }

    currentPriceButton.disabled = true;
    const quote = await actions.useCurrentPrice(symbol);
    currentPriceButton.disabled = false;

    if (Number.isFinite(quote?.price)) {
      state.buyCurrency = quote.currency || "USD";
      form.elements.buyPrice.value = quote.price.toFixed(2);
      updateCurrencyNote();
      updateSharePreview();
    }
  });

  updateCurrencyNote();
  updateSharePreview();

  function readForm() {
    return {
      id: state.editingId,
      symbol: form.elements.symbol.value,
      investmentUsd: form.elements.investmentUsd.value,
      buyPrice: form.elements.buyPrice.value,
      buyCurrency: state.buyCurrency,
    };
  }

  function loadHolding(holding) {
    state.editingId = holding.id;
    state.buyCurrency = holding.buyCurrency ?? "USD";
    form.elements.symbol.value = holding.symbol;
    form.elements.investmentUsd.value = holding.investmentUsd;
    form.elements.buyPrice.value = holding.buyPrice;
    panel.classList.add("is-editing");
    setText(container, '[data-field="title"]', "עריכת מנייה");
    setText(container, '[data-field="subtitle"]', "שמירת השינוי תחליף את הרשומה");
    setText(container, '[data-field="submit-label"]', "שמור");
    updateCurrencyNote();
    updateSharePreview();
  }

  function reset() {
    state.editingId = null;
    state.buyCurrency = "USD";
    form.reset();
    panel.classList.remove("is-editing");
    setText(container, '[data-field="title"]', "הוספת מנייה");
    setText(container, '[data-field="subtitle"]', "סכום, מחיר קנייה וכמות מחושבת");
    setText(container, '[data-field="submit-label"]', "הוסף");
    updateCurrencyNote();
    updateSharePreview();
  }

  function updateSharePreview() {
    const investment = Number(form.elements.investmentUsd.value);
    const buyPrice = Number(form.elements.buyPrice.value);
    const shares = investment > 0 && buyPrice > 0 ? investment / buyPrice : 0;

    setText(container, '[data-field="shares-preview"]', formatNumber(shares, 6));
  }

  function updateCurrencyNote() {
    const note = query(container, '[data-field="currency-note"]');
    const currency = state.buyCurrency || "USD";

    setText(container, '[data-field="buy-price-label"]', `מחיר קנייה ב-${currency}`);
    note.hidden = currency === "USD";
    note.textContent =
      currency === "USD"
        ? ""
        : `הסכום הכולל נשאר בדולר, מחיר הקנייה יישמר במטבע ${currency}.`;
  }

  return {
    loadHolding,
    reset,
  };
}
