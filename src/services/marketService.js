const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_SUMMARY_BASE = "https://query1.finance.yahoo.com/v10/finance/quoteSummary";
const ALL_ORIGINS_RAW = "https://api.allorigins.win/raw?url=";
const CORS_PROXY_IO = "https://corsproxy.io/?";
const STOOQ_QUOTE_URL = "https://stooq.com/q/l/";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS";
const FRANKFURTER_LATEST_URL = "https://api.frankfurter.dev/v1/latest";
const REQUEST_TIMEOUT_MS = 9000;
const QUOTE_CACHE_MS = 20 * 1000;
const FX_CACHE_MS = 10 * 60 * 1000;
const SYMBOL_ALIASES = {
  RHM: "RHM.DE",
  LDO: "LDO.MI",
  WDEF: "WDEF.L",
};
const COMMON_SUFFIXES = ["US", "DE", "MI", "PA", "AS", "BR", "MC", "SW", "L"];
const QUOTE_CACHE = new Map();
const QUOTE_IN_FLIGHT = new Map();
const USD_ILS_RATE_CACHE = new Map();
const CURRENCY_RATE_CACHE = new Map();
const PROFILE_CACHE = new Map();
const SECTOR_FALLBACKS = {
  ASML: { sector: "Technology", sectorLabel: "שבבים", industry: "Semiconductor Equipment" },
  "ASML.AS": { sector: "Technology", sectorLabel: "שבבים", industry: "Semiconductor Equipment" },
  GEV: { sector: "Industrials", sectorLabel: "תשתיות אנרגיה", industry: "Power Equipment" },
  IBIT: { sector: "Digital Assets", sectorLabel: "קריפטו", industry: "Bitcoin ETF" },
  ICLN: { sector: "Clean Energy", sectorLabel: "אנרגיה ירוקה", industry: "Clean Energy ETF" },
  LABU: { sector: "Healthcare", sectorLabel: "ביוטכנולוגיה", industry: "Leveraged Biotech ETF" },
  LDO: { sector: "Industrials", sectorLabel: "ביטחון", industry: "Aerospace & Defense" },
  "LDO.MI": { sector: "Industrials", sectorLabel: "ביטחון", industry: "Aerospace & Defense" },
  PPH: { sector: "Healthcare", sectorLabel: "רפואה", industry: "Pharmaceutical ETF" },
  RHM: { sector: "Industrials", sectorLabel: "ביטחון", industry: "Aerospace & Defense" },
  "RHM.DE": { sector: "Industrials", sectorLabel: "ביטחון", industry: "Aerospace & Defense" },
  UFO: { sector: "Space", sectorLabel: "חלל", industry: "Space ETF" },
  UPRO: { sector: "Broad Market", sectorLabel: "מדד רחב", industry: "Leveraged S&P 500 ETF" },
  URA: { sector: "Energy", sectorLabel: "אורניום", industry: "Uranium ETF" },
  WDEF: { sector: "International Equity", sectorLabel: "שווקים מפותחים", industry: "Developed Markets ETF" },
};

export async function fetchMarketSnapshot(symbols, extraCurrencies = []) {
  const uniqueSymbols = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];

  const [quoteResults, fxResult] = await Promise.all([
    Promise.allSettled(uniqueSymbols.map((symbol) => fetchQuote(symbol))),
    fetchUsdIlsRate().then(
      (rate) => ({ ok: true, rate }),
      (error) => ({ ok: false, error }),
    ),
  ]);

  const quotes = {};
  const errors = [];

  quoteResults.forEach((result, index) => {
    const symbol = uniqueSymbols[index];

    if (result.status === "fulfilled") {
      quotes[symbol] = result.value;
    } else {
      errors.push({
        symbol,
        message: result.reason?.message ?? "לא ניתן למשוך נתון מחיר",
      });
    }
  });

  Object.keys(quotes).forEach((key) => {
    const fallback = inferProfile(quotes[key].symbol);
    quotes[key] = {
      ...quotes[key],
      ...fallback,
      profileLoaded: false,
      profileSource: "זיהוי מהיר",
    };
  });

  const fxRate = fxResult.ok ? fxResult.rate.value : null;
  const currencyResults = await fetchCurrencyRatesForQuotes(
    Object.values(quotes),
    extraCurrencies,
    fxRate,
  );

  return {
    quotes,
    errors: [...errors, ...currencyResults.errors],
    fxRate,
    fxSource: fxResult.ok ? fxResult.rate.source : null,
    fxError: fxResult.ok ? null : fxResult.error?.message,
    currencyRates: currencyResults.rates,
    updatedAt: new Date().toISOString(),
  };
}

export async function fetchQuote(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    throw new Error("חסר סימול מנייה");
  }

  const cachedQuote = readTimedCache(QUOTE_CACHE, normalizedSymbol, QUOTE_CACHE_MS);

  if (cachedQuote) {
    return cachedQuote;
  }

  if (QUOTE_IN_FLIGHT.has(normalizedSymbol)) {
    return QUOTE_IN_FLIGHT.get(normalizedSymbol);
  }

  const quotePromise = fetchQuoteFresh(normalizedSymbol)
    .then((quote) => {
      writeTimedCache(QUOTE_CACHE, normalizedSymbol, quote);
      writeTimedCache(QUOTE_CACHE, quote.symbol, quote);
      return quote;
    })
    .finally(() => {
      QUOTE_IN_FLIGHT.delete(normalizedSymbol);
    });

  QUOTE_IN_FLIGHT.set(normalizedSymbol, quotePromise);
  return quotePromise;
}

async function fetchQuoteFresh(normalizedSymbol) {
  const errors = [];
  const candidates = buildSymbolCandidates(normalizedSymbol);

  for (const candidate of candidates) {
    const targetUrl = createYahooChartUrl(candidate);

    try {
      const payload = await fetchJson(targetUrl);
      return parseYahooChart(payload, candidate, "Yahoo Finance");
    } catch (error) {
      errors.push(error);
    }

    try {
      const payload = await fetchJson(`${CORS_PROXY_IO}${encodeURIComponent(targetUrl)}`);
      return parseYahooChart(payload, candidate, "Yahoo Finance דרך corsproxy.io");
    } catch (error) {
      errors.push(error);
    }
  }

  for (const candidate of candidates) {
    try {
      return await fetchStooqQuote(candidate);
    } catch (error) {
      errors.push(error);
    }
  }

  for (const candidate of candidates.slice(0, 3)) {
    const targetUrl = createYahooChartUrl(candidate);

    try {
      const payload = await fetchJson(`${ALL_ORIGINS_RAW}${encodeURIComponent(targetUrl)}`);
      return parseYahooChart(payload, candidate, "Yahoo Finance דרך AllOrigins");
    } catch (error) {
      errors.push(error);
    }
  }

  throw new Error(
    `לא ניתן למשוך מחיר עבור ${normalizedSymbol}: ${errors.at(-1)?.message ?? "אין תגובה"}`,
  );
}

export async function fetchQuoteProfileDetails(symbol) {
  return fetchQuoteProfile(symbol);
}

async function fetchQuoteProfile(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (PROFILE_CACHE.has(normalizedSymbol)) {
    return PROFILE_CACHE.get(normalizedSymbol);
  }

  const targetUrl = `${YAHOO_SUMMARY_BASE}/${encodeURIComponent(
    normalizedSymbol,
  )}?modules=assetProfile,summaryProfile,quoteType,price,fundProfile,summaryDetail,defaultKeyStatistics,financialData`;
  const errors = [];

  for (const url of [
    targetUrl,
    `${CORS_PROXY_IO}${encodeURIComponent(targetUrl)}`,
    `${ALL_ORIGINS_RAW}${encodeURIComponent(targetUrl)}`,
  ]) {
    try {
      const payload = await fetchJson(url);
      const profile = parseYahooProfile(payload, normalizedSymbol);
      PROFILE_CACHE.set(normalizedSymbol, profile);
      return profile;
    } catch (error) {
      errors.push(error);
    }
  }

  const fallback = {
    ...inferProfile(normalizedSymbol),
    profileLoaded: false,
    profileSource: "זיהוי מהיר",
  };
  PROFILE_CACHE.set(normalizedSymbol, fallback);
  return fallback;
}

function createYahooChartUrl(symbol) {
  return `${YAHOO_CHART_BASE}/${encodeURIComponent(
    symbol,
  )}?range=1d&interval=1m&includePrePost=true`;
}

export async function fetchUsdIlsRate() {
  const cachedRate = readTimedCache(USD_ILS_RATE_CACHE, "USDILS", FX_CACHE_MS);

  if (cachedRate) {
    return cachedRate;
  }

  try {
    const quote = await fetchQuote("ILS=X");

    if (Number.isFinite(quote.price) && quote.price > 0) {
      const rate = {
        value: quote.price,
        source: quote.source,
      };

      writeTimedCache(USD_ILS_RATE_CACHE, "USDILS", rate);
      return rate;
    }
  } catch (error) {
    console.warn("Yahoo FX failed", error);
  }

  try {
    const quote = await fetchStooqQuote("USDILS", "usdils");

    if (Number.isFinite(quote.price) && quote.price > 0) {
      const rate = {
        value: quote.price,
        source: quote.source,
      };

      writeTimedCache(USD_ILS_RATE_CACHE, "USDILS", rate);
      return rate;
    }
  } catch (error) {
    console.warn("Stooq FX failed", error);
  }

  const response = await fetchJson(FRANKFURTER_URL);
  const value = Number(response?.rates?.ILS);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("לא ניתן למשוך שער USD/ILS");
  }

  const rate = {
    value,
    source: "Frankfurter",
  };

  writeTimedCache(USD_ILS_RATE_CACHE, "USDILS", rate);
  return rate;
}

export async function fetchCurrencyRateToUsd(currency, usdIlsRate = null) {
  const normalizedCurrency = normalizeCurrencyCode(currency);

  if (normalizedCurrency === "USD") {
    return {
      currency: "USD",
      value: 1,
      source: "USD",
    };
  }

  const cachedRate = readTimedCache(CURRENCY_RATE_CACHE, normalizedCurrency, FX_CACHE_MS);

  if (cachedRate) {
    return cachedRate;
  }

  if (normalizedCurrency === "ILS" && Number.isFinite(usdIlsRate) && usdIlsRate > 0) {
    const rate = {
      currency: "ILS",
      value: 1 / usdIlsRate,
      source: "USD/ILS",
    };

    writeTimedCache(CURRENCY_RATE_CACHE, normalizedCurrency, rate);
    return rate;
  }

  if (normalizedCurrency === "GBX") {
    const gbpRate = await fetchCurrencyRateToUsd("GBP", usdIlsRate);

    return {
      currency: "GBX",
      value: gbpRate.value / 100,
      source: gbpRate.source,
    };
  }

  try {
    const quote = await fetchQuote(`${normalizedCurrency}USD=X`);

    if (Number.isFinite(quote.price) && quote.price > 0) {
      const rate = {
        currency: normalizedCurrency,
        value: quote.price,
        source: quote.source,
      };

      writeTimedCache(CURRENCY_RATE_CACHE, normalizedCurrency, rate);
      return rate;
    }
  } catch (error) {
    console.warn(`${normalizedCurrency}/USD Yahoo FX failed`, error);
  }

  const url = `${FRANKFURTER_LATEST_URL}?base=${encodeURIComponent(
    normalizedCurrency,
  )}&symbols=USD`;
  const response = await fetchJson(url);
  const value = Number(response?.rates?.USD);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`לא ניתן למשוך שער ${normalizedCurrency}/USD`);
  }

  const rate = {
    currency: normalizedCurrency,
    value,
    source: "Frankfurter",
  };

  writeTimedCache(CURRENCY_RATE_CACHE, normalizedCurrency, rate);
  return rate;
}

async function fetchStooqQuote(symbol, stooqSymbol = toStooqSymbol(symbol)) {
  if (!stooqSymbol) {
    throw new Error("סימול לא נתמך ב-Stooq");
  }

  const params = new URLSearchParams({
    s: stooqSymbol,
    f: "sd2t2ohlcv",
    h: "",
    e: "csv",
  });
  const targetUrl = `${STOOQ_QUOTE_URL}?${params.toString()}`;
  const csv = await fetchText(`${CORS_PROXY_IO}${encodeURIComponent(targetUrl)}`);

  return parseStooqCsv(csv, symbol, "Stooq דרך corsproxy.io");
}

function parseYahooChart(payload, symbol, source) {
  const error = payload?.chart?.error;

  if (error) {
    throw new Error(error.description ?? "שגיאת Yahoo Finance");
  }

  const result = payload?.chart?.result?.[0];

  if (!result) {
    throw new Error("תגובה ריקה מ-Yahoo Finance");
  }

  const meta = result.meta ?? {};
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const timestamps = result.timestamp ?? [];
  const lastIndex = findLastFiniteIndex(closes);
  const fallbackPrice = lastIndex >= 0 ? Number(closes[lastIndex]) : null;
  const price = fallbackPrice ?? numberOrNull(meta.regularMarketPrice);
  const regularPrice = numberOrNull(meta.regularMarketPrice) ?? price;
  const previousClose =
    numberOrNull(meta.previousClose) ??
    numberOrNull(meta.chartPreviousClose) ??
    findPreviousClose(closes, lastIndex);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("מחיר נוכחי לא נמצא");
  }

  const change = Number.isFinite(previousClose) ? price - previousClose : null;
  const changePercent =
    Number.isFinite(change) && Number.isFinite(previousClose) && previousClose !== 0
      ? (change / previousClose) * 100
      : null;
  const marketTime =
    numberOrNull(meta.regularMarketTime) !== null
      ? new Date(Number(meta.regularMarketTime) * 1000).toISOString()
      : lastIndex >= 0 && timestamps[lastIndex]
        ? new Date(Number(timestamps[lastIndex]) * 1000).toISOString()
        : null;

  return {
    symbol,
    price,
    regularPrice,
    extendedPrice:
      Number.isFinite(regularPrice) && Number.isFinite(price) && Math.abs(price - regularPrice) > 0.000001
        ? price
        : null,
    previousClose,
    change,
    changePercent,
    currency: normalizeCurrencyCode(meta.currency ?? "USD"),
    exchangeName: meta.exchangeName ?? "",
    fullExchangeName: meta.fullExchangeName ?? meta.exchangeName ?? "",
    instrumentType: meta.instrumentType ?? "",
    timezone: meta.exchangeTimezoneName ?? "",
    tradingPeriods: normalizeTradingPeriods(meta.currentTradingPeriod),
    source,
    marketTime,
  };
}

function parseYahooProfile(payload, symbol) {
  const result = payload?.quoteSummary?.result?.[0];

  if (!result) {
    throw new Error("פרופיל Yahoo ריק");
  }

  const assetProfile = result.assetProfile ?? result.summaryProfile ?? {};
  const quoteType = result.quoteType ?? {};
  const price = result.price ?? {};
  const fundProfile = result.fundProfile ?? {};
  const summaryDetail = result.summaryDetail ?? {};
  const defaultKeyStatistics = result.defaultKeyStatistics ?? {};
  const financialData = result.financialData ?? {};
  const fallback = inferProfile(symbol);
  const sector = assetProfile.sector ?? fundProfile.categoryName ?? fallback.sector;
  const industry = assetProfile.industry ?? fundProfile.legalType ?? fallback.industry;
  const hasSpecificFallbackSector = fallback.sector && fallback.sector !== "Other";

  return {
    longName:
      quoteType.longName ??
      price.longName ??
      price.shortName ??
      quoteType.shortName ??
      fallback.longName,
    quoteType: quoteType.quoteType ?? fallback.quoteType,
    sector,
    sectorLabel: hasSpecificFallbackSector ? fallback.sectorLabel : translateSector(sector),
    industry,
    country: assetProfile.country ?? fallback.country,
    website: assetProfile.website ?? "",
    businessSummary: assetProfile.longBusinessSummary ?? "",
    employees: rawValue(assetProfile.fullTimeEmployees),
    marketCap: rawValue(price.marketCap) ?? rawValue(summaryDetail.marketCap),
    dayHigh: rawValue(summaryDetail.dayHigh),
    dayLow: rawValue(summaryDetail.dayLow),
    fiftyTwoWeekHigh: rawValue(summaryDetail.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: rawValue(summaryDetail.fiftyTwoWeekLow),
    volume: rawValue(summaryDetail.volume),
    averageVolume: rawValue(summaryDetail.averageVolume),
    beta: rawValue(defaultKeyStatistics.beta),
    trailingPE: rawValue(summaryDetail.trailingPE),
    forwardPE: rawValue(summaryDetail.forwardPE),
    dividendYield: rawValue(summaryDetail.dividendYield),
    targetMeanPrice: rawValue(financialData.targetMeanPrice),
    recommendationKey: financialData.recommendationKey ?? "",
    profitMargins: rawValue(defaultKeyStatistics.profitMargins),
    revenueGrowth: rawValue(financialData.revenueGrowth),
    grossMargins: rawValue(financialData.grossMargins),
    debtToEquity: rawValue(financialData.debtToEquity),
    profileLoaded: true,
    profileSource: "Yahoo Finance Profile",
  };
}

async function fetchJson(url) {
  const responseText = await fetchText(url);
  return JSON.parse(responseText);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rawValue(value) {
  const raw = value && typeof value === "object" && "raw" in value ? value.raw : value;
  return numberOrNull(raw);
}

function findLastFiniteIndex(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(Number(values[index]))) {
      return index;
    }
  }

  return -1;
}

function findPreviousClose(values, lastIndex) {
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    const value = Number(values[index]);

    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function parseStooqCsv(csv, symbol, source) {
  const [headerLine, rowLine] = String(csv ?? "")
    .trim()
    .split(/\r?\n/);

  if (!headerLine || !rowLine) {
    throw new Error("תגובה ריקה מ-Stooq");
  }

  const headers = parseCsvLine(headerLine);
  const values = parseCsvLine(rowLine);
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  const price = numberOrNull(row.Close);
  const open = numberOrNull(row.Open);

  if (!Number.isFinite(price) || price <= 0 || row.Date === "N/D") {
    throw new Error("Stooq לא החזיר מחיר תקין");
  }

  const change = Number.isFinite(open) ? price - open : null;
  const changePercent =
    Number.isFinite(change) && Number.isFinite(open) && open !== 0 ? (change / open) * 100 : null;
  const marketTime = row.Date && row.Time ? new Date(`${row.Date}T${row.Time}`).toISOString() : null;

  return {
    symbol: normalizeSymbol(symbol),
    price,
    previousClose: open,
    change,
    changePercent,
    currency: symbol === "USDILS" ? "ILS" : inferStooqCurrency(row.Symbol, symbol),
    exchangeName: row.Symbol ?? "",
    source,
    marketTime,
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let isQuoted = false;

  for (const character of line) {
    if (character === '"') {
      isQuoted = !isQuoted;
      continue;
    }

    if (character === "," && !isQuoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function toStooqSymbol(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (!normalizedSymbol || normalizedSymbol.includes("=")) {
    return null;
  }

  if (normalizedSymbol === "USDILS") {
    return "usdils";
  }

  return normalizedSymbol.includes(".")
    ? normalizedSymbol.toLowerCase()
    : `${normalizedSymbol}.us`.toLowerCase();
}

function buildSymbolCandidates(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return [];
  }

  if (normalizedSymbol.includes(".") || normalizedSymbol.includes("=")) {
    return [normalizedSymbol];
  }

  const candidates = [];
  const alias = SYMBOL_ALIASES[normalizedSymbol];

  if (alias) {
    candidates.push(alias);
  }

  candidates.push(normalizedSymbol);
  candidates.push(...COMMON_SUFFIXES.map((suffix) => `${normalizedSymbol}.${suffix}`));

  return [...new Set(candidates)];
}

async function fetchCurrencyRatesForQuotes(quotes, extraCurrencies, usdIlsRate) {
  const currencies = [
    ...new Set(
      [...quotes.map((quote) => quote.currency), ...extraCurrencies]
        .map(normalizeCurrencyCode)
        .filter(Boolean),
    ),
  ];
  const rates = { USD: 1 };
  const errors = [];

  if (Number.isFinite(usdIlsRate) && usdIlsRate > 0) {
    rates.ILS = 1 / usdIlsRate;
  }

  const missingCurrencies = currencies.filter((currency) => rates[currency] === undefined);
  const results = await Promise.allSettled(
    missingCurrencies.map((currency) => fetchCurrencyRateToUsd(currency, usdIlsRate)),
  );

  results.forEach((result, index) => {
    const currency = missingCurrencies[index];

    if (result.status === "fulfilled") {
      rates[currency] = result.value.value;
    } else {
      errors.push({
        symbol: currency,
        message: result.reason?.message ?? `לא ניתן למשוך שער ${currency}/USD`,
      });
    }
  });

  return { rates, errors };
}

function normalizeCurrencyCode(currency) {
  if (currency === "GBp") {
    return "GBX";
  }

  return String(currency || "USD").trim().toUpperCase();
}

function readTimedCache(cache, key, maxAgeMs) {
  const entry = cache.get(normalizeSymbol(key));

  if (!entry || Date.now() - entry.cachedAt > maxAgeMs) {
    return null;
  }

  return entry.value;
}

function writeTimedCache(cache, key, value) {
  cache.set(normalizeSymbol(key), {
    value,
    cachedAt: Date.now(),
  });
}

function normalizeTradingPeriods(currentTradingPeriod) {
  if (!currentTradingPeriod || typeof currentTradingPeriod !== "object") {
    return null;
  }

  return Object.fromEntries(
    ["pre", "regular", "post"]
      .map((key) => {
        const period = currentTradingPeriod[key];

        if (!period || !Number.isFinite(Number(period.start)) || !Number.isFinite(Number(period.end))) {
          return null;
        }

        return [
          key,
          {
            start: Number(period.start),
            end: Number(period.end),
            timezone: period.timezone ?? "",
            gmtOffset: Number(period.gmtoffset ?? period.gmtOffset ?? 0),
          },
        ];
      })
      .filter(Boolean),
  );
}

function inferStooqCurrency(stooqSymbol, requestedSymbol) {
  const symbol = String(stooqSymbol || requestedSymbol || "").toUpperCase();

  if (symbol === "USDILS") {
    return "ILS";
  }

  const suffix = symbol.includes(".") ? symbol.split(".").at(-1) : "";
  const suffixCurrencies = {
    US: "USD",
    DE: "EUR",
    F: "EUR",
    PA: "EUR",
    AS: "EUR",
    BR: "EUR",
    MI: "EUR",
    MC: "EUR",
    LS: "EUR",
    L: "GBX",
    SW: "CHF",
    TO: "CAD",
    V: "CAD",
    AX: "AUD",
    HK: "HKD",
    T: "JPY",
    ST: "SEK",
    OL: "NOK",
    CO: "DKK",
    WA: "PLN",
  };

  return suffixCurrencies[suffix] ?? "USD";
}

function inferProfile(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const fallback =
    SECTOR_FALLBACKS[normalizedSymbol] ??
    SECTOR_FALLBACKS[SYMBOL_ALIASES[normalizedSymbol]] ??
    {};

  return {
    longName: fallback.longName ?? normalizedSymbol,
    quoteType: fallback.quoteType ?? "",
    sector: fallback.sector ?? "Other",
    sectorLabel: fallback.sectorLabel ?? translateSector(fallback.sector ?? "Other"),
    industry: fallback.industry ?? "",
    country: fallback.country ?? "",
    website: "",
  };
}

function translateSector(sector) {
  const normalizedSector = String(sector || "Other").toLowerCase();
  const labels = {
    "technology": "טכנולוגיה",
    "healthcare": "רפואה",
    "financial services": "פיננסים",
    "consumer cyclical": "צריכה מחזורית",
    "consumer defensive": "צריכה בסיסית",
    "communication services": "תקשורת",
    "industrials": "תעשייה",
    "energy": "אנרגיה",
    "utilities": "תשתיות",
    "real estate": "נדל״ן",
    "basic materials": "חומרי גלם",
    "digital assets": "קריפטו",
    "clean energy": "אנרגיה ירוקה",
    "space": "חלל",
    "broad market": "מדד רחב",
    "international equity": "שווקים מפותחים",
    "other": "אחר",
  };

  return labels[normalizedSector] ?? sector ?? "אחר";
}
