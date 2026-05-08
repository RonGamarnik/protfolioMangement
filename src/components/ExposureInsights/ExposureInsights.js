import { loadTemplate, escapeHtml } from "../../lib/template.js";
import { query, setTextIfChanged } from "../../lib/dom.js";
import { formatCurrency, formatPercent, signed } from "../../lib/formatters.js";

const COLORS = ["#1df2d0", "#7c9cff", "#f7b955", "#ff5f7f", "#35e49b", "#a78bfa", "#38bdf8", "#fb7185"];

export async function createExposureInsights(container, actions) {
  const template = await loadTemplate(new URL("./ExposureInsights.html", import.meta.url));
  container.innerHTML = template;

  query(container, '[data-action="close-exposure"]').addEventListener("click", () => {
    actions.closeExposureInsights?.();
  });

  function render(computed) {
    const rows = computed.rows
      .filter((row) => Number.isFinite(row.allocationPercent) && row.allocationPercent > 0)
      .sort((a, b) => b.allocationPercent - a.allocationPercent);
    const sectors = buildSectorRows(rows);

    paintPie(
      query(container, '[data-field="portfolio-pie"]'),
      query(container, '[data-field="portfolio-legend"]'),
      rows.map((row, index) => ({
        label: row.symbol,
        percentValue: row.allocationPercent,
        color: COLORS[index % COLORS.length],
      })),
      "אין חשיפה להצגה",
    );

    paintPie(
      query(container, '[data-field="sector-pie"]'),
      query(container, '[data-field="sector-legend"]'),
      sectors.map((row, index) => ({
        label: row.label,
        percentValue: row.percent,
        color: COLORS[(index + 2) % COLORS.length],
      })),
      "אין מידע סקטורים",
    );

    renderBars(query(container, '[data-field="bars"]'), rows);
    renderStats(rows, sectors, computed.totals);

    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }
  }

  function renderStats(rows, sectors, totals) {
    const topHolding = rows[0];
    const topThree = rows.slice(0, 3).reduce((sum, row) => sum + row.allocationPercent, 0);
    const topSector = sectors[0];

    setTextIfChanged(container, '[data-field="portfolio-value"]', formatCurrency(totals.currentValueUsd, "USD"), {
      animate: true,
    });
    setTextIfChanged(
      container,
      '[data-field="daily-move"]',
      signed(totals.dailyChangeUsd, (value) => formatCurrency(value, "USD")),
      { animate: true },
    );
    setTextIfChanged(
      container,
      '[data-field="top-sector"]',
      topSector ? `${topSector.label} ${formatPercent(topSector.percent)}` : "--",
      { animate: true },
    );
    setTextIfChanged(container, '[data-field="sector-count"]', `${sectors.length} סקטורים`);
    setTextIfChanged(
      container,
      '[data-field="top-holding"]',
      topHolding ? `${topHolding.symbol} ${formatPercent(topHolding.allocationPercent)}` : "--",
      { animate: true },
    );
    setTextIfChanged(container, '[data-field="top-three"]', formatPercent(topThree), { animate: true });
  }

  return {
    render,
  };
}

function buildSectorRows(rows) {
  const sectorMap = new Map();

  rows.forEach((row) => {
    const label = row.quote?.sectorLabel || row.quote?.sector || "אחר";
    sectorMap.set(label, (sectorMap.get(label) || 0) + row.allocationPercent);
  });

  return [...sectorMap.entries()]
    .map(([label, percent]) => ({ label, percent }))
    .sort((a, b) => b.percent - a.percent);
}

function paintPie(chart, legend, rows, emptyText) {
  if (!rows.length) {
    chart.style.background = "var(--surface-soft)";
    legend.innerHTML = `<span class="exposure-legend__empty">${escapeHtml(emptyText)}</span>`;
    return;
  }

  const total = rows.reduce((sum, row) => sum + row.percentValue, 0);
  const factor = total > 100 ? 100 / total : 1;
  let cursor = 0;
  const stops = rows.map((row) => {
    const start = cursor;
    const end = cursor + row.percentValue * factor;
    cursor = end;
    return `${row.color} ${start}% ${end}%`;
  });

  if (cursor < 100) {
    stops.push(`var(--surface-soft) ${cursor}% 100%`);
  }

  chart.style.background = `conic-gradient(${stops.join(", ")})`;
  legend.innerHTML = rows
    .map(
      (row) => `
        <span class="exposure-legend__item">
          <i style="background:${row.color}"></i>
          <strong>${escapeHtml(row.label)}</strong>
          <em>${formatPercent(row.percentValue)}</em>
        </span>
      `,
    )
    .join("");
}

function renderBars(container, rows) {
  if (!rows.length) {
    container.innerHTML = '<span class="exposure-legend__empty">אין אחזקות להצגה</span>';
    return;
  }

  container.innerHTML = rows
    .slice(0, 10)
    .map(
      (row) => `
        <article class="exposure-bar">
          <strong>${escapeHtml(row.symbol)}</strong>
          <div class="exposure-bar__track">
            <div class="exposure-bar__fill" style="--value:${Math.min(row.allocationPercent, 100)}%"></div>
          </div>
          <span>${formatPercent(row.allocationPercent)}</span>
        </article>
      `,
    )
    .join("");
}
