import { loadTemplate } from "../../lib/template.js";
import { escapeHtml } from "../../lib/template.js";
import { query } from "../../lib/dom.js";
import { formatPercent } from "../../lib/formatters.js";

const PIE_COLORS = ["#1df2d0", "#7c9cff", "#f7b955", "#ff5f7f", "#35e49b", "#a78bfa", "#38bdf8", "#fb7185"];
const PERCENT_INPUT_PRECISION = 6;
const PERCENT_INPUT_STEP = "0.000001";

export async function createAllocationPlanner(container, actions, settings) {
  const template = await loadTemplate(new URL("./AllocationPlanner.html", import.meta.url));
  container.innerHTML = template;

  const form = query(container, '[data-field="form"]');
  const totalBudgetInput = query(container, '[data-field="total-budget"]');
  const rowsContainer = query(container, '[data-field="rows"]');
  const totalPercent = query(container, '[data-field="total-percent"]');
  const addButton = query(container, '[data-action="add-row"]');
  const closeButton = query(container, '[data-action="close-allocation-panel"]');
  const sourceCurrentButton = query(container, '[data-action="source-current"]');
  const sourceBuyButton = query(container, '[data-action="source-buy"]');
  const allocationModeLabel = query(container, '[data-field="allocation-mode-label"]');
  const pie = query(container, '[data-field="pie"]');
  const legend = query(container, '[data-field="legend"]');
  const sectorPie = query(container, '[data-field="sector-pie"]');
  const sectorLegend = query(container, '[data-field="sector-legend"]');
  const rows = [];
  const state = {
    sourceMode: "current",
    holdings: [],
    fallbackBudget: settings.totalBudgetUsd,
    computedRows: [],
  };

  totalBudgetInput.value = settings.totalBudgetUsd;

  addButton.addEventListener("click", () => {
    rows.push(createRow("", "", ""));
    renderRows();
  });

  closeButton.addEventListener("click", () => {
    actions.closeAllocationEditor?.();
  });

  sourceCurrentButton.addEventListener("click", () => {
    setSourceMode("current");
  });

  sourceBuyButton.addEventListener("click", () => {
    setSourceMode("buy");
  });

  totalBudgetInput.addEventListener("input", () => {
    actions.updateSettings({ totalBudgetUsd: Number(totalBudgetInput.value) || 0 });
  });

  form.addEventListener("input", (event) => {
    const rowElement = event.target.closest("[data-row-id]");

    if (!rowElement) {
      updateTotal();
      return;
    }

    const row = rows.find((item) => item.id === rowElement.dataset.rowId);

    if (!row) {
      return;
    }

    const nextSymbol = rowElement.querySelector('[name="symbol"]').value;

    if (normalizeSymbol(nextSymbol) !== normalizeSymbol(row.symbol)) {
      row.sector = "";
      row.sectorLabel = "";
    }

    row.symbol = nextSymbol;
    row.percent = rowElement.querySelector('[name="percent"]').value;
    row.buyPrice = rowElement.querySelector('[name="buyPrice"]').value;
    updateTotal();
  });

  form.addEventListener("click", (event) => {
    const deleteButton = event.target.closest('[data-action="delete-row"]');

    if (!deleteButton) {
      return;
    }

    const rowId = deleteButton.closest("[data-row-id]")?.dataset.rowId;
    const index = rows.findIndex((row) => row.id === rowId);

    if (index >= 0) {
      const symbol = rows[index].symbol || "השורה הזאת";
      const confirmed = window.confirm(`להסיר את ${symbol} מהחלוקה?`);

      if (!confirmed) {
        return;
      }

      rows.splice(index, 1);
      renderRows();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    actions.applyAllocation({
      totalBudgetUsd: totalBudgetInput.value,
      rows,
    });
  });

  loadDefaults();
  renderRows();

  function loadHoldings(holdings, fallbackBudget, computedRows = []) {
    state.holdings = Array.isArray(holdings) ? holdings : [];
    state.fallbackBudget = fallbackBudget;
    state.computedRows = Array.isArray(computedRows) ? computedRows : [];
    loadRowsFromSource();
  }

  function loadRowsFromSource() {
    rows.splice(0, rows.length);
    const sourceRows =
      state.sourceMode === "buy"
        ? createBuySourceRows(state.holdings, state.computedRows)
        : createExposureSourceRows(state.holdings, state.computedRows);
    const totalInvested = state.holdings.reduce(
      (sum, holding) => sum + (Number(holding.investmentUsd) || 0),
      0,
    );
    const allocationRows = createAllocationRows(sourceRows);
    totalBudgetInput.value =
      totalInvested > 0 ? totalInvested.toFixed(2) : state.fallbackBudget || settings.totalBudgetUsd;

    if (allocationRows.length) {
      allocationRows.forEach((row) => {
        rows.push(
          createRow(
            row.symbol,
            row.percent,
            row.buyPrice,
            {
              sector: row.sector,
              sectorLabel: row.sectorLabel,
            },
          ),
        );
      });
    } else if (state.holdings.length && totalInvested > 0) {
      createAllocationRows(
        state.holdings.map((holding) => ({
          symbol: holding.symbol,
          buyPrice: holding.buyPrice,
          exposureValueUsd: Number(holding.investmentUsd),
        })),
      ).forEach((holding) => {
        rows.push(
          createRow(
            holding.symbol,
            holding.percent,
            holding.buyPrice,
          ),
        );
      });
    } else {
      loadDefaults();
    }

    renderRows();
  }

  function setSourceMode(mode) {
    if (state.sourceMode === mode) {
      return;
    }

    state.sourceMode = mode;
    loadRowsFromSource();
  }

  function renderRows() {
    syncSourceMode();
    rowsContainer.innerHTML = rows.map(renderRow).join("");
    updateTotal();

    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }
  }

  function updateTotal() {
    const value = rows.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);
    totalPercent.textContent = formatPercent(value);
    totalPercent.classList.toggle("is-complete", Math.abs(value - 100) <= 0.01);
    renderPie();
    renderSectorPie();
  }

  function renderPie() {
    const activeRows = rows
      .map((row, index) => ({
        label: row.symbol || "ללא סימול",
        percentValue: Number(row.percent) || 0,
        color: PIE_COLORS[index % PIE_COLORS.length],
      }))
      .filter((row) => row.percentValue > 0);

    paintPie(pie, legend, activeRows, "אין חלוקה להצגה");
    return;

    if (!activeRows.length) {
      pie.style.background = "var(--surface-soft)";
      legend.innerHTML = '<span class="allocation-legend__empty">אין חלוקה להצגה</span>';
      return;
    }

    const totalPercent = activeRows.reduce((sum, row) => sum + row.percentValue, 0);
    const factor = totalPercent > 100 ? 100 / totalPercent : 1;
    let cursor = 0;
    const stops = activeRows.map((row) => {
      const start = cursor;
      const end = cursor + row.percentValue * factor;
      cursor = end;
      return `${row.color} ${start}% ${end}%`;
    });

    if (cursor < 100) {
      stops.push(`var(--surface-soft) ${cursor}% 100%`);
    }

    pie.style.background = `conic-gradient(${stops.join(", ")})`;
    legend.innerHTML = activeRows
      .map(
        (row) => `
          <span class="allocation-legend__item">
            <i style="background:${row.color}"></i>
            <strong>${escapeHtml(row.symbol || "ללא סימול")}</strong>
            <em>${formatPercent(row.percentValue)}</em>
          </span>
        `,
      )
      .join("");
  }

  function renderSectorPie() {
    const sectorMap = new Map();

    rows.forEach((row) => {
      const percentValue = Number(row.percent) || 0;

      if (percentValue <= 0) {
        return;
      }

      const label = row.sectorLabel || row.sector || "אחר";
      sectorMap.set(label, (sectorMap.get(label) || 0) + percentValue);
    });

    const activeRows = [...sectorMap.entries()]
      .map(([label, percentValue], index) => ({
        label,
        percentValue: roundPercent(percentValue),
        color: PIE_COLORS[(index + 2) % PIE_COLORS.length],
      }))
      .sort((a, b) => b.percentValue - a.percentValue);

    paintPie(sectorPie, sectorLegend, activeRows, "אין מידע סקטורים");
  }

  function loadDefaults() {
    rows.splice(0, rows.length);
    rows.push(createRow("AAPL", 40, ""), createRow("MSFT", 35, ""), createRow("NVDA", 25, ""));
  }

  function syncSourceMode() {
    const isBuyMode = state.sourceMode === "buy";
    sourceCurrentButton.setAttribute("aria-pressed", String(!isBuyMode));
    sourceBuyButton.setAttribute("aria-pressed", String(isBuyMode));
    allocationModeLabel.textContent = isBuyMode ? "לפי התפלגות קנייה" : "לפי שווי נוכחי";
  }

  return {
    loadHoldings,
  };
}

function paintPie(chart, chartLegend, activeRows, emptyText) {
  if (!chart || !chartLegend) {
    return;
  }

  if (!activeRows.length) {
    chart.style.background = "var(--surface-soft)";
    chartLegend.innerHTML = `<span class="allocation-legend__empty">${escapeHtml(emptyText)}</span>`;
    return;
  }

  const totalPercent = activeRows.reduce((sum, row) => sum + row.percentValue, 0);
  const factor = totalPercent > 100 ? 100 / totalPercent : 1;
  let cursor = 0;
  const stops = activeRows.map((row) => {
    const start = cursor;
    const end = cursor + row.percentValue * factor;
    cursor = end;
    return `${row.color} ${start}% ${end}%`;
  });

  if (cursor < 100) {
    stops.push(`var(--surface-soft) ${cursor}% 100%`);
  }

  chart.style.background = `conic-gradient(${stops.join(", ")})`;
  chartLegend.innerHTML = activeRows
    .map(
      (row) => `
        <span class="allocation-legend__item">
          <i style="background:${row.color}"></i>
          <strong>${escapeHtml(row.label)}</strong>
          <em>${formatPercent(row.percentValue)}</em>
        </span>
      `,
    )
    .join("");
}

function createExposureSourceRows(holdings, computedRows) {
  const computedById = new Map(
    computedRows
      .filter((row) => row?.id)
      .map((row) => [row.id, row]),
  );

  return holdings
    .map((holding) => {
      const computed = computedById.get(holding.id) ?? null;
      const exposureValueUsd = getExposureValue(computed ?? holding);

      return {
        symbol: computed?.symbol ?? holding.symbol,
        buyPrice: computed?.buyPrice ?? holding.buyPrice,
        exposureValueUsd,
        sector: computed?.quote?.sector ?? "",
        sectorLabel: computed?.quote?.sectorLabel ?? "",
      };
    })
    .filter((row) => row.symbol && Number.isFinite(row.exposureValueUsd) && row.exposureValueUsd > 0);
}

function createBuySourceRows(holdings, computedRows) {
  const computedById = new Map(
    computedRows
      .filter((row) => row?.id)
      .map((row) => [row.id, row]),
  );

  return holdings
    .map((holding) => {
      const computed = computedById.get(holding.id) ?? null;
      const exposureValueUsd = Number(holding.investmentUsd);

      return {
        symbol: holding.symbol,
        buyPrice: holding.buyPrice,
        exposureValueUsd,
        sector: computed?.quote?.sector ?? "",
        sectorLabel: computed?.quote?.sectorLabel ?? "",
      };
    })
    .filter((row) => row.symbol && Number.isFinite(row.exposureValueUsd) && row.exposureValueUsd > 0);
}

function createAllocationRows(sourceRows) {
  const activeRows = sourceRows.filter(
    (row) => row.symbol && Number.isFinite(row.exposureValueUsd) && row.exposureValueUsd > 0,
  );
  const totalExposure = activeRows.reduce((sum, row) => sum + row.exposureValueUsd, 0);

  if (!activeRows.length || totalExposure <= 0) {
    return [];
  }

  let allocatedPercent = 0;

  return activeRows.map((row, index) => {
    const isLastRow = index === activeRows.length - 1;
    const exactPercent = (row.exposureValueUsd / totalExposure) * 100;
    const percent = isLastRow
      ? clampPercent(roundPercentInput(100 - allocatedPercent))
      : roundPercentInput(exactPercent);

    allocatedPercent = roundPercentInput(allocatedPercent + percent);
    return {
      ...row,
      percent,
    };
  });
}

function getExposureValue(row) {
  const currentValueUsd = Number(row?.currentValueUsd);

  if (Number.isFinite(currentValueUsd) && currentValueUsd > 0) {
    return currentValueUsd;
  }

  const allocationValueUsd = Number(row?.allocationValueUsd);

  if (Number.isFinite(allocationValueUsd) && allocationValueUsd > 0) {
    return allocationValueUsd;
  }

  const investedUsd = Number(row?.investedUsd ?? row?.investmentUsd);
  return Number.isFinite(investedUsd) && investedUsd > 0 ? investedUsd : 0;
}

function createRow(symbol, percent, buyPrice, meta = {}) {
  return {
    id: crypto.randomUUID(),
    symbol,
    percent,
    buyPrice,
    sector: meta.sector ?? "",
    sectorLabel: meta.sectorLabel ?? "",
  };
}

function roundPercent(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundPercentInput(value) {
  const factor = 10 ** PERCENT_INPUT_PRECISION;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase();
}

function renderRow(row) {
  return `
    <div class="allocation-row" data-row-id="${escapeHtml(row.id)}">
      <label class="field">
        <span>סימול</span>
        <input name="symbol" value="${escapeHtml(row.symbol)}" placeholder="AAPL" autocomplete="off" />
      </label>
      <label class="field">
        <span>אחוז</span>
        <input name="percent" value="${escapeHtml(row.percent)}" type="number" min="0" max="100" step="${PERCENT_INPUT_STEP}" />
      </label>
      <label class="field">
        <span>מחיר קנייה</span>
        <input name="buyPrice" value="${escapeHtml(row.buyPrice)}" type="number" min="0" step="0.01" />
      </label>
      <button class="icon-button" type="button" data-action="delete-row" aria-label="מחיקת שורה">
        <i data-lucide="minus"></i>
      </button>
    </div>
  `;
}
