import { loadTemplate } from "../../lib/template.js";
import { query, setTextIfChanged } from "../../lib/dom.js";
import { formatCurrency, formatPercent, metricClass, signed } from "../../lib/formatters.js";

const palette = ["#0f766e", "#2457c5", "#a65f00", "#6b4dbb", "#0f8b5f", "#bd2f4c"];
const LRI = "\u2066";
const PDI = "\u2069";

export async function renderSummaryCards(container, computed, state, actions = {}) {
  if (container.dataset.ready !== "1") {
    const template = await loadTemplate(new URL("./SummaryCards.html", import.meta.url));
    container.innerHTML = template;
    bindExposureCard(container, actions);
    container.dataset.ready = "1";
  }

  const { totals, rows } = computed;
  const summaryGrid = query(container, ".summary-grid");
  const pnlCard = query(container, '[data-field="pnl-card"]');
  const dailyCard = query(container, '[data-field="daily-card"]');
  const ubsCard = query(container, '[data-field="ubs-card"]');
  const pnlClass = metricClass(totals.pnlUsd);
  const dailyClass = metricClass(totals.dailyChangeUsd);

  summaryGrid.classList.toggle("has-ubs-mode", Boolean(totals.ubsMode));
  pnlCard.classList.toggle("is-positive", pnlClass === "metric-up");
  pnlCard.classList.toggle("is-negative", pnlClass === "metric-down");
  dailyCard.classList.toggle("is-positive", dailyClass === "metric-up");
  dailyCard.classList.toggle("is-negative", dailyClass === "metric-down");
  ubsCard.hidden = !totals.ubsMode;

  setTextIfChanged(container, '[data-field="current-usd"]', formatCurrency(totals.currentValueUsd, "USD"), {
    animate: true,
  });
  setTextIfChanged(container, '[data-field="current-ils"]', formatCurrency(totals.currentValueIls, "ILS"), {
    animate: true,
  });
  setTextIfChanged(
    container,
    '[data-field="invested-usd"]',
    `השקעה ${isolateCurrency(formatCurrency(totals.totalInvestedUsd, "USD"))}`,
  );
  setTextIfChanged(
    container,
    '[data-field="invested-ils"]',
    `מהשקעה ${isolateCurrency(formatCurrency(totals.totalInvestedIls, "ILS"))}`,
  );
  setTextIfChanged(
    container,
    '[data-field="pnl-usd"]',
    signed(totals.pnlUsd, (value) => formatCurrency(value, "USD")),
    { animate: true },
  );
  setTextIfChanged(container, '[data-field="pnl-percent"]', signed(totals.pnlPercent, formatPercent), {
    animate: true,
  });
  setTextIfChanged(
    container,
    '[data-field="daily-usd"]',
    signed(totals.dailyChangeUsd, (value) => formatCurrency(value, "USD")),
    { animate: true },
  );
  setTextIfChanged(container, '[data-field="daily-percent"]', signed(totals.dailyChangePercent, formatPercent), {
    animate: true,
  });
  setTextIfChanged(
    container,
    '[data-field="ubs-principal-usd"]',
    formatCurrency(totals.ubsPrincipalUsd, "USD"),
    { animate: true },
  );
  setTextIfChanged(
    container,
    '[data-field="ubs-principal-ils"]',
    `${formatCurrency(totals.ubsPrincipalIls, "ILS")} excluded`,
  );

  renderAllocationStrip(query(container, '[data-field="allocation-strip"]'), rows);
}

function bindExposureCard(container, actions) {
  const exposureCard = query(container, '[data-action="open-allocation-chart"]');
  exposureCard.addEventListener("click", () => actions.openExposureInsights?.());
  exposureCard.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      actions.openExposureInsights?.();
    }
  });
}

function isolateCurrency(value) {
  return `${LRI}${value}${PDI}`;
}

function renderAllocationStrip(container, rows) {
  if (!container) {
    return;
  }

  const rowsWithAllocation = rows
    .filter((row) => Number.isFinite(row.allocationPercent) && row.allocationPercent > 0)
    .sort((a, b) => b.allocationPercent - a.allocationPercent);

  if (!rowsWithAllocation.length) {
    updateStripBackground(container, "var(--surface-soft)");
    return;
  }

  let cursor = 0;
  const stops = rowsWithAllocation.map((row, index) => {
    const color = palette[index % palette.length];
    const start = cursor;
    const end = Math.min(cursor + Math.max(row.allocationPercent, 0), 100);
    cursor = end;
    return `${color} ${start}% ${end}%`;
  });

  if (cursor < 100) {
    stops.push(`var(--surface-soft) ${cursor}% 100%`);
  }

  updateStripBackground(container, `linear-gradient(90deg, ${stops.join(", ")})`);
}

function updateStripBackground(container, background) {
  if (container.dataset.background === background) {
    return;
  }

  container.dataset.background = background;
  container.style.background = background;
  container.classList.remove("is-updating");
  void container.offsetWidth;
  container.classList.add("is-updating");
}
