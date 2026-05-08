import { loadTemplate, renderTemplate } from "../../lib/template.js";
import { query, setElementTextIfChanged, setTextIfChanged } from "../../lib/dom.js";
import { renderEmptyState } from "../EmptyState/EmptyState.js";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
  metricClass,
  signed,
} from "../../lib/formatters.js";

export async function renderHoldingsTable(container, computed, actions, options = {}) {
  if (container.dataset.ready !== "1") {
    const template = await loadTemplate(new URL("./HoldingsTable.html", import.meta.url));
    container.innerHTML = template;
    bindActions(container, actions);
    container.dataset.ready = "1";
  }

  const { rows } = computed;
  syncSortHeaders(container, options.sortKey || "symbol-asc");
  setTextIfChanged(container, '[data-field="count"]', `${rows.length} מניות`);

  const tableWrap = query(container, '[data-field="table-wrap"]');
  const rowsContainer = query(container, '[data-field="rows"]');
  const emptyContainer = query(container, '[data-field="empty"]');

  if (!rows.length) {
    tableWrap.hidden = true;
    await renderEmptyState(emptyContainer);
    rowsContainer.innerHTML = "";
    return;
  }

  tableWrap.hidden = false;
  emptyContainer.innerHTML = "";
  await patchRows(rowsContainer, rows);
}

function bindActions(container, actions) {
  query(container, '[data-action="edit-portfolio"]').addEventListener("click", () => {
    actions.openAllocationEditor();
  });

  container.addEventListener("click", (event) => {
    const sortButton = event.target.closest("[data-sort-key]");

    if (!sortButton) {
      return;
    }

    actions.updateHoldingsSort?.(nextSortKey(sortButton.dataset.sortKey, sortButton.dataset.sortDirection));
  });

  const rowsContainer = query(container, '[data-field="rows"]');
  rowsContainer.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");

    if (button?.dataset.action === "edit") {
      actions.editHolding(button.dataset.id);
      return;
    }

    if (button?.dataset.action === "delete") {
      actions.deleteHolding(button.dataset.id);
      return;
    }

    const row = event.target.closest("tr[data-id]");

    if (row) {
      toggleDetails(rowsContainer, row.dataset.id);
    }
  });
}

function syncSortHeaders(container, sortKey) {
  const [field, direction] = String(sortKey || "symbol-asc").split("-");

  container.querySelectorAll("[data-sort-key]").forEach((button) => {
    const isActive = button.dataset.sortKey === field;
    button.classList.toggle("is-active", isActive);
    button.dataset.sortDirection = isActive ? direction : "";
    button.setAttribute(
      "aria-sort",
      isActive ? (direction === "asc" ? "ascending" : "descending") : "none",
    );
    const icon = button.querySelector("i");

    if (icon) {
      icon.setAttribute(
        "data-lucide",
        isActive ? (direction === "asc" ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow") : "chevrons-up-down",
      );
    }
  });

  if (window.lucide?.createIcons) {
    window.lucide.createIcons();
  }
}

function nextSortKey(field, currentDirection) {
  const nextDirection = currentDirection === "desc" ? "asc" : "desc";

  if (field === "symbol" && !currentDirection) {
    return "symbol-asc";
  }

  return `${field}-${nextDirection}`;
}

async function patchRows(container, rows) {
  const rowTemplate = await loadTemplate(new URL("./HoldingRow.html", import.meta.url));
  const liveIds = new Set(rows.map((row) => row.id));
  let needsIconRefresh = false;

  [...container.querySelectorAll("tr[data-id], tr[data-detail-id]")].forEach((element) => {
    const id = element.dataset.id || element.dataset.detailId;

    if (!liveIds.has(id)) {
      element.remove();
    }
  });

  rows.forEach((row) => {
    const model = viewModel(row);
    let rowElement = container.querySelector(`tr[data-id="${CSS.escape(row.id)}"]`);

    if (!rowElement) {
      const wrapper = document.createElement("tbody");
      wrapper.innerHTML = renderTemplate(rowTemplate, model);
      const fragment = document.createDocumentFragment();
      rowElement = wrapper.querySelector("tr[data-id]");
      [...wrapper.children].forEach((child) => fragment.append(child));
      container.append(fragment);
      needsIconRefresh = patchRow(rowElement, model) || true;
      return;
    }

    needsIconRefresh = patchRow(rowElement, model) || needsIconRefresh;
    container.append(rowElement);
    const detailElement = container.querySelector(`tr[data-detail-id="${CSS.escape(row.id)}"]`);

    if (detailElement) {
      container.append(detailElement);
    }
  });

  if (needsIconRefresh && window.lucide?.createIcons) {
    window.lucide.createIcons();
  }
}

function patchRow(rowElement, model) {
  const animatedFields = new Set();
  const detailElement = rowElement.nextElementSibling?.dataset.detailId === rowElement.dataset.id
    ? rowElement.nextElementSibling
    : null;

  Object.entries(model).forEach(([key, value]) => {
    if (
      key === "id" ||
      key === "pnlClass" ||
      key === "dailyClass" ||
      key === "allocationValue" ||
      key === "sessionClass" ||
      key === "sessionIcon" ||
      key === "sessionTitle" ||
      key === "extendedIcon" ||
      key === "extendedTitle"
    ) {
      return;
    }

    const element =
      rowElement.querySelector(`[data-field="${key}"]`) ??
      detailElement?.querySelector(`[data-field="${key}"]`);

    if (element) {
      setElementTextIfChanged(element, value, { animate: animatedFields.has(key) });
    }
  });

  const sessionIconChanged = patchSessionChip(rowElement, model);
  const extendedIconChanged = patchExtendedMove(rowElement, model);

  const pnlCell = rowElement.querySelector('[data-field="pnlCell"]');
  pnlCell?.classList.toggle("metric-up", model.pnlClass === "metric-up");
  pnlCell?.classList.toggle("metric-down", model.pnlClass === "metric-down");
  pnlCell?.classList.toggle("metric-flat", model.pnlClass === "metric-flat");

  const dailyCell = rowElement.querySelector('[data-field="dailyCell"]');
  dailyCell?.classList.toggle("metric-up", model.dailyClass === "metric-up");
  dailyCell?.classList.toggle("metric-down", model.dailyClass === "metric-down");
  dailyCell?.classList.toggle("metric-flat", model.dailyClass === "metric-flat");

  const meter = rowElement.querySelector('[data-field="allocationMeter"]');

  if (meter && meter.value !== model.allocationValue) {
    meter.value = model.allocationValue;
  }

  if (rowElement.classList.contains("is-open") && detailElement) {
    const panel = detailElement.querySelector(".holding-detail");

    if (panel) {
      panel.style.maxHeight = `${panel.scrollHeight}px`;
    }
  }

  return sessionIconChanged || extendedIconChanged;
}

function patchSessionChip(rowElement, model) {
  const chip = rowElement.querySelector('[data-field="marketSession"]');

  if (!chip) {
    return false;
  }

  chip.className = `market-session-chip ${model.sessionClass}`;
  chip.title = model.sessionTitle;

  if (chip.dataset.icon !== model.sessionIcon) {
    chip.dataset.icon = model.sessionIcon;
    const label = chip.querySelector('[data-field="sessionLabel"]')?.textContent ?? model.sessionLabel;
    chip.innerHTML = `<i data-lucide="${model.sessionIcon}"></i><span data-field="sessionLabel"></span>`;
    chip.querySelector('[data-field="sessionLabel"]').textContent = label;
    return true;
  }

  return false;
}

function patchExtendedMove(rowElement, model) {
  const extendedMove = rowElement.querySelector('[data-field="extendedMove"]');

  if (!extendedMove) {
    return false;
  }

  extendedMove.hidden = !model.extendedMoveText;
  extendedMove.title = model.extendedTitle;

  if (extendedMove.dataset.icon !== model.extendedIcon) {
    extendedMove.dataset.icon = model.extendedIcon;
    const text = extendedMove.querySelector('[data-field="extendedMoveText"]')?.textContent ?? model.extendedMoveText;
    extendedMove.innerHTML = `<i data-lucide="${model.extendedIcon}"></i><span data-field="extendedMoveText"></span>`;
    extendedMove.querySelector('[data-field="extendedMoveText"]').textContent = text;
    return true;
  }

  return false;
}

function toggleDetails(container, id) {
  const row = container.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
  const detail = container.querySelector(`tr[data-detail-id="${CSS.escape(id)}"]`);

  if (!row || !detail) {
    return;
  }

  const isOpen = row.classList.contains("is-open");

  container.querySelectorAll("tr[data-id].is-open").forEach((openRow) => {
    openRow.classList.remove("is-open");
    openRow.setAttribute("aria-expanded", "false");
    const openDetail = container.querySelector(`tr[data-detail-id="${CSS.escape(openRow.dataset.id)}"]`);

    if (openDetail) {
      closeDetail(openDetail);
    }
  });

  if (!isOpen) {
    row.classList.add("is-open");
    row.setAttribute("aria-expanded", "true");
    detail.hidden = false;
    const panel = detail.querySelector(".holding-detail");
    panel.style.maxHeight = `${panel.scrollHeight}px`;
  }
}

function closeDetail(detail) {
  const panel = detail.querySelector(".holding-detail");
  panel.style.maxHeight = "0px";
  window.setTimeout(() => {
    if (panel.style.maxHeight === "0px") {
      detail.hidden = true;
    }
  }, 260);
}

function viewModel(row) {
  const quote = row.quote ?? {};
  const pnlClass = metricClass(row.pnlUsd);
  const dailyClass = metricClass(row.dailyChangeUsd);
  const marketSession = row.marketSession ?? {
    label: "השוק סגור",
    icon: "lock",
    className: "is-closed",
    exchangeLabel: "",
    nextOpenAt: null,
  };
  const sessionDetailParts = [marketSession.label, marketSession.exchangeLabel].filter(Boolean);
  const nextOpenText = marketSession.nextOpenAt
    ? `פתיחה הבאה ${formatDateTime(marketSession.nextOpenAt)}`
    : "";

  return {
    id: row.id,
    symbol: row.symbol,
    exchange: [quote.exchangeName, row.quoteCurrency].filter(Boolean).join(" / ") || "USD",
    sessionLabel: marketSession.label,
    sessionClass: marketSession.className,
    sessionIcon: marketSession.icon,
    sessionTitle: [marketSession.label, marketSession.exchangeLabel, nextOpenText]
      .filter(Boolean)
      .join(" · "),
    shares: formatNumber(row.shares, 6),
    buyPrice: formatCurrency(row.buyPrice, row.buyCurrency),
    investedUsd: formatCurrency(row.investedUsd, "USD"),
    investedIls: formatCurrency(row.investedIls, "ILS"),
    currentPrice: formatCurrency(row.currentPrice, row.quoteCurrency),
    quoteTime: quote.marketTime ? formatDateTime(quote.marketTime) : "אין נתון",
    currentValueUsd: formatCurrency(row.currentValueUsd, "USD"),
    currentValueIls: formatCurrency(row.currentValueIls, "ILS"),
    pnlClass,
    pnlUsd: signed(row.pnlUsd, (value) => formatCurrency(value, "USD")),
    pnlPercent: signed(row.pnlPercent, formatPercent),
    dailyClass,
    dailyUsd: signed(row.dailyChangeUsd, (value) => formatCurrency(value, "USD")),
    dailyPercent: signed(row.dailyChangePercent, formatPercent),
    extendedMoveText: formatExtendedMove(row),
    extendedIcon: getExtendedIcon(row),
    extendedTitle: getExtendedTitle(row),
    allocation: formatPercent(row.allocationPercent),
    allocationValue: Number.isFinite(row.allocationPercent) ? row.allocationPercent : 0,
    detailName: quote.longName || row.symbol,
    detailMeta: [quote.instrumentType || quote.quoteType, quote.exchangeName, row.quoteCurrency]
      .filter(Boolean)
      .join(" / "),
    sector: quote.sectorLabel || quote.sector || "אחר",
    fullExchange: quote.fullExchangeName || quote.exchangeName || "אין נתון",
    quoteCurrencyDetail: row.quoteCurrency,
    buyCurrencyDetail: row.buyCurrency,
    currencyRate: Number.isFinite(row.buyCurrencyToUsd) ? formatNumber(row.buyCurrencyToUsd, 4) : "--",
    previousClose: formatCurrency(quote.previousClose, row.quoteCurrency),
    dailyDetail: [
      signed(row.dailyChangeUsd, (value) => formatCurrency(value, "USD")),
      signed(row.dailyChangePercent, formatPercent),
    ].join(" / "),
    dataSource: quote.source || "אין נתון",
    sessionDetail: [...sessionDetailParts, nextOpenText].filter(Boolean).join(" / "),
  };
}

function formatExtendedMove(row) {
  if (!Number.isFinite(row.extendedChangeUsd)) {
    return "";
  }

  if (Math.abs(row.extendedChangeUsd) < 0.005 && Math.abs(row.extendedChangePercent ?? 0) < 0.005) {
    return "";
  }

  const amount = signed(row.extendedChangeUsd, (value) => formatCurrency(value, "USD"));
  const percent = signed(row.extendedChangePercent, formatPercent);

  return `${amount} / ${percent}`;
}

function getExtendedIcon(row) {
  return row.marketSession?.status === "pre" ? "sunrise" : "moon";
}

function getExtendedTitle(row) {
  return row.marketSession?.status === "pre" ? "Pre-Market move" : "After-Market move";
}
