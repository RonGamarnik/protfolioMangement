const currencyFormatterCache = new Map();

const numberFormatter = new Intl.NumberFormat("he-IL", {
  maximumFractionDigits: 4,
});

const compactNumberFormatter = new Intl.NumberFormat("he-IL", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat("he-IL", {
  style: "percent",
  maximumFractionDigits: 2,
});

const dateTimeFormatter = new Intl.DateTimeFormat("he-IL", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

export function formatCurrency(value, currency = "USD") {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const normalizedCurrency = normalizeCurrency(currency);

  if (normalizedCurrency === "GBX") {
    return `${formatNumber(value, 2)} GBX`;
  }

  try {
    return getCurrencyFormatter(normalizedCurrency).format(value);
  } catch (error) {
    return `${formatNumber(value, 2)} ${normalizedCurrency}`;
  }
}

export function formatNumber(value, maximumFractionDigits = 4) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat("he-IL", {
    maximumFractionDigits,
  }).format(value);
}

export function formatCompact(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return compactNumberFormatter.format(value);
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return percentFormatter.format(value / 100);
}

export function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  return dateTimeFormatter.format(new Date(value));
}

export function formatRate(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return numberFormatter.format(value);
}

export function metricClass(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.000001) {
    return "metric-flat";
  }

  return value > 0 ? "metric-up" : "metric-down";
}

export function signed(value, formatter = formatNumber) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatter(value)}`;
}

function getCurrencyFormatter(currency) {
  if (currencyFormatterCache.has(currency)) {
    return currencyFormatterCache.get(currency);
  }

  const formatter = new Intl.NumberFormat(currency === "ILS" ? "he-IL" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });

  currencyFormatterCache.set(currency, formatter);
  return formatter;
}

function normalizeCurrency(currency) {
  if (currency === "GBp") {
    return "GBX";
  }

  return String(currency || "USD").trim().toUpperCase();
}
