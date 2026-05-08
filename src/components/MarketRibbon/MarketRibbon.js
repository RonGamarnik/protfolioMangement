import { loadTemplate } from "../../lib/template.js";
import { query, setTextIfChanged } from "../../lib/dom.js";
import { formatDateTime, formatRate } from "../../lib/formatters.js";

export async function renderMarketRibbon(container, state) {
  if (container.dataset.ready !== "1") {
    const template = await loadTemplate(new URL("./MarketRibbon.html", import.meta.url));
    container.innerHTML = template;
    container.dataset.ready = "1";
  }

  const ribbon = query(container, ".market-ribbon");
  const hasErrors = state.market.errors.length > 0;
  const isClosed = state.holdings.length > 0 && state.market.refreshableCount === 0;

  ribbon.classList.toggle("is-loading", state.market.isLoading);
  ribbon.classList.toggle("has-errors", hasErrors);
  ribbon.classList.toggle("is-closed", isClosed);

  let stateText = "תיק ריק";

  if (state.market.isLoading) {
    stateText = "מושך נתוני שוק";
  } else if (hasErrors) {
    stateText = "חלק מהנתונים לא זמינים";
  } else if (isClosed) {
    stateText = "כל השווקים סגורים";
  } else if (state.market.refreshableCount > 0) {
    stateText = `${state.market.refreshableCount}/${state.holdings.length} בשעות מסחר`;
  } else if (state.holdings.length) {
    stateText = "נתוני תיק זמינים";
  }
  const sourceText =
    isClosed && state.market.nextMarketOpenAt
      ? `פתיחה הבאה ${formatDateTime(state.market.nextMarketOpenAt)}`
      : state.market.sourceLabel || "--";

  setTextIfChanged(container, '[data-field="state"]', stateText);
  setTextIfChanged(container, '[data-field="fx"]', formatRate(state.market.fxRate), { animate: true });
  setTextIfChanged(container, '[data-field="updated"]', formatDateTime(state.market.lastUpdated));
  setTextIfChanged(container, '[data-field="source"]', sourceText);
}
