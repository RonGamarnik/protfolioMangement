export function createHolding({
  id,
  symbol,
  investmentUsd,
  buyPrice,
  buyCurrency = "USD",
  currencyRateToUsd = 1,
}) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const investment = toPositiveNumber(investmentUsd);
  const price = toPositiveNumber(buyPrice);
  const normalizedCurrency = normalizeCurrency(buyCurrency);
  const rateToUsd = toPositiveNumber(currencyRateToUsd);

  if (!normalizedSymbol) {
    throw new Error("חסר סימול מנייה");
  }

  if (!investment) {
    throw new Error("סכום ההשקעה חייב להיות גדול מאפס");
  }

  if (!price) {
    throw new Error("מחיר הקנייה חייב להיות גדול מאפס");
  }

  if (!rateToUsd) {
    throw new Error(`לא ניתן לחשב שער ${normalizedCurrency}/USD`);
  }

  return {
    id: id || crypto.randomUUID(),
    symbol: normalizedSymbol,
    investmentUsd: roundMoney(investment),
    buyPrice: roundMoney(price),
    buyCurrency: normalizedCurrency,
    buyCurrencyToUsd: rateToUsd,
    shares: roundShares(investment / (price * rateToUsd)),
    createdAt: new Date().toISOString(),
  };
}

export function upsertHolding(holdings, nextHolding) {
  if (holdings.some((holding) => holding.id === nextHolding.id)) {
    return holdings.map((holding) =>
      holding.id === nextHolding.id ? { ...nextHolding, createdAt: holding.createdAt } : holding,
    );
  }

  const existing = holdings.find(
    (holding) =>
      holding.symbol === nextHolding.symbol &&
      normalizeCurrency(holding.buyCurrency) === normalizeCurrency(nextHolding.buyCurrency),
  );

  if (!existing) {
    return [...holdings, nextHolding];
  }

  const mergedInvestment = existing.investmentUsd + nextHolding.investmentUsd;
  const mergedShares = existing.shares + nextHolding.shares;
  const mergedBuyCost =
    existing.shares * existing.buyPrice + nextHolding.shares * nextHolding.buyPrice;

  return holdings.map((holding) =>
    holding.id === existing.id
      ? {
          ...holding,
          investmentUsd: roundMoney(mergedInvestment),
          shares: roundShares(mergedShares),
          buyPrice: roundMoney(mergedBuyCost / mergedShares),
          buyCurrency: normalizeCurrency(existing.buyCurrency),
        }
      : holding,
  );
}

export function holdingsFromAllocation(totalBudgetUsd, rows) {
  const total = toPositiveNumber(totalBudgetUsd);

  if (!total) {
    throw new Error("סכום כולל חייב להיות גדול מאפס");
  }

  const cleanRows = rows
    .map((row) => ({
      symbol: normalizeSymbol(row.symbol),
      percent: toPositiveNumber(row.percent),
      buyPrice: toPositiveNumber(row.buyPrice),
      buyCurrency: normalizeCurrency(row.buyCurrency ?? "USD"),
      currencyRateToUsd: toPositiveNumber(row.currencyRateToUsd ?? 1),
    }))
    .filter((row) => row.symbol || row.percent || row.buyPrice);

  if (!cleanRows.length) {
    throw new Error("צריך לפחות מנייה אחת לחלוקה");
  }

  const percentTotal = cleanRows.reduce((sum, row) => sum + row.percent, 0);

  if (Math.abs(percentTotal - 100) > 0.01) {
    throw new Error("סך האחוזים חייב להיות 100%");
  }

  return cleanRows.map((row) =>
    createHolding({
      symbol: row.symbol,
      investmentUsd: (total * row.percent) / 100,
      buyPrice: row.buyPrice,
      buyCurrency: row.buyCurrency,
      currencyRateToUsd: row.currencyRateToUsd,
    }),
  );
}

export function calculatePortfolio(
  holdings,
  quotes,
  fxRate,
  currencyRates = { USD: 1 },
  options = {},
) {
  const ubsMode = Boolean(options.ubsMode);
  const marketSessions = options.marketSessions ?? {};
  const rows = holdings.map((holding) => {
    const holdingSymbol = normalizeSymbol(holding.symbol);
    const quote = findQuote(quotes, holdingSymbol);
    const session = marketSessions[holdingSymbol] ?? marketSessions[quote?.symbol] ?? null;
    const buyCurrency = normalizeCurrency(holding.buyCurrency ?? "USD");
    const quoteCurrency = normalizeCurrency(quote?.currency ?? buyCurrency);
    const quoteToUsdRate =
      getCurrencyRate(currencyRates, quoteCurrency) ??
      (quoteCurrency === buyCurrency ? toPositiveNumber(holding.buyCurrencyToUsd) : null);
    const currentPrice = Number.isFinite(quote?.price) ? quote.price : null;
    const regularPrice = Number.isFinite(quote?.regularPrice) ? quote.regularPrice : currentPrice;
    const previousClose = Number.isFinite(quote?.previousClose) ? quote.previousClose : null;
    const isExtendedSession = session?.status === "pre" || session?.status === "post";
    const hasExtendedPrice =
      Number.isFinite(quote?.extendedPrice) ||
      (
        Number.isFinite(currentPrice) &&
        Number.isFinite(regularPrice) &&
        Math.abs(currentPrice - regularPrice) > 0.000001 &&
        (isExtendedSession || session?.status === "closed")
      );
    const dailyPrice = hasExtendedPrice && Number.isFinite(regularPrice) ? regularPrice : currentPrice;
    const investedUsd = Number(holding.investmentUsd);
    const currentValueNative = Number.isFinite(currentPrice)
      ? roundMoney(holding.shares * currentPrice)
      : null;
    const currentValueUsd =
      Number.isFinite(currentValueNative) && Number.isFinite(quoteToUsdRate)
        ? roundMoney(currentValueNative * quoteToUsdRate)
        : null;
    const dailyValueUsd =
      Number.isFinite(dailyPrice) &&
      Number.isFinite(holding.shares) &&
      Number.isFinite(quoteToUsdRate)
        ? roundMoney(holding.shares * dailyPrice * quoteToUsdRate)
        : null;
    const previousDailyValueUsd =
      Number.isFinite(previousClose) &&
      Number.isFinite(holding.shares) &&
      Number.isFinite(quoteToUsdRate)
        ? roundMoney(holding.shares * previousClose * quoteToUsdRate)
        : null;
    const rawPnlUsd = Number.isFinite(currentValueUsd) ? roundMoney(currentValueUsd - investedUsd) : null;
    const ubsPrincipalUsd =
      ubsMode && Number.isFinite(currentValueUsd) && currentValueUsd < investedUsd
        ? roundMoney(investedUsd - currentValueUsd)
        : 0;
    const performanceValueUsd =
      Number.isFinite(currentValueUsd) ? roundMoney(currentValueUsd + ubsPrincipalUsd) : null;
    const dailyPerformanceValueUsd = calculatePerformanceValue(
      dailyValueUsd,
      investedUsd,
      ubsMode,
    );
    const previousPerformanceValueUsd = calculatePerformanceValue(
      previousDailyValueUsd,
      investedUsd,
      ubsMode,
    );
    const pnlUsd = Number.isFinite(performanceValueUsd)
      ? roundMoney(performanceValueUsd - investedUsd)
      : null;
    const pnlPercent =
      Number.isFinite(pnlUsd) && investedUsd > 0 ? roundPercent((pnlUsd / investedUsd) * 100) : null;
    const dailyChangeUsd =
      Number.isFinite(dailyPerformanceValueUsd) && Number.isFinite(previousPerformanceValueUsd)
        ? roundMoney(dailyPerformanceValueUsd - previousPerformanceValueUsd)
        : null;
    const dailyChangePercent =
      Number.isFinite(dailyChangeUsd) &&
      Number.isFinite(previousPerformanceValueUsd) &&
      previousPerformanceValueUsd > 0
        ? roundPercent((dailyChangeUsd / previousPerformanceValueUsd) * 100)
        : null;
    const extendedChangeUsd =
      hasExtendedPrice &&
      Number.isFinite(currentPrice) &&
      Number.isFinite(regularPrice) &&
      Number.isFinite(holding.shares) &&
      Number.isFinite(quoteToUsdRate)
        ? roundMoney(holding.shares * (currentPrice - regularPrice) * quoteToUsdRate)
        : null;
    const extendedChangePercent =
      hasExtendedPrice &&
      Number.isFinite(currentPrice) &&
      Number.isFinite(regularPrice) &&
      regularPrice !== 0
        ? roundPercent(((currentPrice - regularPrice) / regularPrice) * 100)
        : null;

    return {
      ...holding,
      quote,
      buyCurrency,
      quoteCurrency,
      quoteToUsdRate,
      investedUsd,
      investedIls: convertToIls(investedUsd, fxRate),
      currentPrice,
      regularPrice,
      currentValueNative,
      currentValueUsd,
      currentValueIls: convertToIls(currentValueUsd, fxRate),
      rawPnlUsd,
      ubsPrincipalUsd,
      ubsPrincipalIls: convertToIls(ubsPrincipalUsd, fxRate),
      performanceValueUsd,
      dailyPerformanceValueUsd,
      previousPerformanceValueUsd,
      pnlUsd,
      pnlPercent,
      dailyChangeUsd,
      dailyChangeIls: convertToIls(dailyChangeUsd, fxRate),
      dailyChangePercent,
      extendedChangeUsd,
      extendedChangeIls: convertToIls(extendedChangeUsd, fxRate),
      extendedChangePercent,
      hasQuote: Boolean(quote) && Number.isFinite(currentValueUsd),
    };
  });

  const totalInvestedUsd = sum(rows, "investedUsd");
  const quotedRows = rows.filter((row) => row.hasQuote);
  const quotedInvestedUsd = sum(quotedRows, "investedUsd");
  const currentValueUsd = quotedRows.length ? sum(quotedRows, "currentValueUsd") : null;
  const performanceValueUsd = quotedRows.length ? sum(quotedRows, "performanceValueUsd") : null;
  const previousPerformanceValueUsd = quotedRows.length
    ? sum(quotedRows, "previousPerformanceValueUsd")
    : null;
  const ubsPrincipalUsd = ubsMode ? sum(quotedRows, "ubsPrincipalUsd") : 0;
  const pnlUsd = Number.isFinite(performanceValueUsd)
    ? roundMoney(performanceValueUsd - quotedInvestedUsd)
    : null;
  const dailyChangeUsd = quotedRows.length ? sum(quotedRows, "dailyChangeUsd") : null;
  const extendedChangeUsd = quotedRows.length ? sum(quotedRows, "extendedChangeUsd") : null;
  const previousValueUsd =
    Number.isFinite(previousPerformanceValueUsd)
      ? previousPerformanceValueUsd
      : Number.isFinite(currentValueUsd) && Number.isFinite(dailyChangeUsd)
        ? roundMoney(currentValueUsd - dailyChangeUsd)
        : null;

  const totalAllocationUsd = roundMoney(
    rows.reduce((sum, row) => sum + getAllocationValueUsd(row), 0),
  );
  const rowsWithAllocation = rows.map((row) => {
    const allocationValueUsd = getAllocationValueUsd(row);

    return {
      ...row,
      allocationValueUsd,
      allocationPercent:
        totalAllocationUsd > 0 ? roundPercent((allocationValueUsd / totalAllocationUsd) * 100) : null,
    };
  });

  return {
    rows: rowsWithAllocation,
    totals: {
      holdingsCount: rows.length,
      quotedCount: quotedRows.length,
      totalInvestedUsd,
      totalInvestedIls: convertToIls(totalInvestedUsd, fxRate),
      currentValueUsd,
      currentValueIls: convertToIls(currentValueUsd, fxRate),
      performanceValueUsd,
      pnlUsd,
      pnlPercent:
        Number.isFinite(pnlUsd) && quotedInvestedUsd > 0
          ? roundPercent((pnlUsd / quotedInvestedUsd) * 100)
          : null,
      ubsMode,
      ubsPrincipalUsd,
      ubsPrincipalIls: convertToIls(ubsPrincipalUsd, fxRate),
      dailyChangeUsd,
      dailyChangeIls: convertToIls(dailyChangeUsd, fxRate),
      dailyChangePercent:
        Number.isFinite(dailyChangeUsd) && Number.isFinite(previousValueUsd) && previousValueUsd > 0
          ? roundPercent((dailyChangeUsd / previousValueUsd) * 100)
          : null,
      extendedChangeUsd,
      extendedChangeIls: convertToIls(extendedChangeUsd, fxRate),
      quoteCoveragePercent: rows.length ? roundPercent((quotedRows.length / rows.length) * 100) : 0,
    },
  };
}

function getAllocationValueUsd(row) {
  if (Number.isFinite(row.currentValueUsd) && row.currentValueUsd > 0) {
    return row.currentValueUsd;
  }

  if (Number.isFinite(row.investedUsd) && row.investedUsd > 0) {
    return row.investedUsd;
  }

  return 0;
}

function sum(rows, key) {
  return roundMoney(
    rows.reduce((total, row) => {
      const value = Number(row[key]);
      return Number.isFinite(value) ? total + value : total;
    }, 0),
  );
}

function convertToIls(value, fxRate) {
  if (!Number.isFinite(value) || !Number.isFinite(fxRate)) {
    return null;
  }

  return roundMoney(value * fxRate);
}

function getCurrencyRate(currencyRates, currency) {
  const rate = Number(currencyRates?.[normalizeCurrency(currency)]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function calculatePerformanceValue(valueUsd, investedUsd, ubsMode) {
  if (!Number.isFinite(valueUsd)) {
    return null;
  }

  if (!ubsMode || !Number.isFinite(investedUsd)) {
    return valueUsd;
  }

  return valueUsd < investedUsd ? investedUsd : valueUsd;
}

function findQuote(quotes, symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const directQuote = quotes?.[normalizedSymbol];

  if (directQuote) {
    return directQuote;
  }

  return (
    Object.values(quotes ?? {}).find(
      (quote) => normalizeSymbol(quote?.symbol) === normalizedSymbol,
    ) ?? null
  );
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase();
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeCurrency(currency) {
  if (currency === "GBp") {
    return "GBX";
  }

  return String(currency || "USD").trim().toUpperCase();
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundShares(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100000000) / 100000000;
}

function roundPercent(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
