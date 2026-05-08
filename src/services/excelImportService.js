const DEFAULT_COLUMN_MAP = {
  name: 0,
  symbol: 1,
  price: 2,
  quantity: 3,
};

const HEADER_ALIASES = {
  name: ["שם", "שם נייר", "שם מניה", "name", "security", "holding"],
  symbol: ["מס נייר", "מספר נייר", "סימול", "טיקר", "symbol", "ticker"],
  price: ["שער בפועל", "שער", "מחיר", "מחיר קניה", "price", "buy price", "current price"],
  quantity: ["כמות", "יחידות", "מניות", "quantity", "shares", "units"],
};

const CURRENCY_CODES = new Set([
  "USD",
  "EUR",
  "ILS",
  "GBP",
  "GBX",
  "CHF",
  "CAD",
  "AUD",
  "JPY",
  "HKD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
]);

export function parseExcelPortfolioPaste(rawText) {
  const raw = String(rawText ?? "").replace(/\u00a0/g, " ").trim();

  if (!raw) {
    return {
      rows: [],
      errors: [],
    };
  }

  const rows = [];
  const errors = [];
  const lines = raw
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  let columnMap = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const cells = splitPastedLine(line);

    if (!columnMap) {
      const detectedColumnMap = detectHeaderColumns(cells);

      if (detectedColumnMap) {
        columnMap = detectedColumnMap;
        return;
      }
    }

    const activeColumnMap = columnMap ?? inferDefaultColumnMap(cells);
    const parsedRow = parseDataRow(cells, activeColumnMap, lineNumber);

    if (parsedRow.ok) {
      rows.push(parsedRow.row);
      return;
    }

    errors.push({
      lineNumber,
      message: parsedRow.message,
      raw: line,
    });
  });

  return {
    rows,
    errors,
  };
}

function splitPastedLine(line) {
  const text = String(line ?? "").trim();

  if (text.includes("\t")) {
    return text.split("\t").map(cleanCell);
  }

  if (text.includes(";")) {
    return text.split(";").map(cleanCell);
  }

  return text.split(/\s{2,}/).map(cleanCell);
}

function cleanCell(value) {
  return String(value ?? "")
    .trim()
    .replace(/^"|"$/g, "")
    .replaceAll('""', '"');
}

function detectHeaderColumns(cells) {
  const detected = {};

  cells.forEach((cell, index) => {
    const field = matchHeaderField(cell);

    if (field && detected[field] === undefined) {
      detected[field] = index;
    }
  });

  if (
    detected.symbol !== undefined &&
    detected.price !== undefined &&
    detected.quantity !== undefined
  ) {
    return {
      ...DEFAULT_COLUMN_MAP,
      ...detected,
    };
  }

  return null;
}

function matchHeaderField(value) {
  const normalized = normalizeHeader(value);

  return Object.entries(HEADER_ALIASES).find(([, aliases]) =>
    aliases.some((alias) => normalized === normalizeHeader(alias)),
  )?.[0];
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[׳'`"״’]/g, "")
    .replace(/\s+/g, " ");
}

function inferDefaultColumnMap(cells) {
  if (cells.length >= 5 && isRowNumber(cells[0]) && isLikelySymbol(cells[2])) {
    return {
      name: 1,
      symbol: 2,
      price: 3,
      quantity: 4,
    };
  }

  return DEFAULT_COLUMN_MAP;
}

function parseDataRow(cells, columnMap, lineNumber) {
  const name = cells[columnMap.name] ?? "";
  const symbol = normalizeSymbol(cells[columnMap.symbol]);
  const priceText = cells[columnMap.price] ?? "";
  const quantityText = cells[columnMap.quantity] ?? "";
  const price = parseLooseNumber(priceText);
  const quantity = parseLooseNumber(quantityText);
  const currency = detectCurrency(priceText);

  if (!symbol || !isLikelySymbol(symbol)) {
    return {
      ok: false,
      message: "חסר סימול תקין",
    };
  }

  if (!Number.isFinite(price) || price <= 0) {
    return {
      ok: false,
      message: `שער לא תקין עבור ${symbol || `שורה ${lineNumber}`}`,
    };
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      ok: false,
      message: `כמות לא תקינה עבור ${symbol}`,
    };
  }

  return {
    ok: true,
    row: {
      lineNumber,
      name: cleanCell(name),
      symbol,
      price,
      quantity,
      currency,
      rawPrice: priceText,
      rawQuantity: quantityText,
    },
  };
}

function parseLooseNumber(value) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[−–]/g, "-")
    .replace(/[^\d,.-]/g, "");

  if (!/\d/.test(cleaned)) {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? cleaned.replaceAll(".", "").replace(",", ".")
        : cleaned.replaceAll(",", "");
  } else if (lastComma >= 0) {
    const commaParts = cleaned.split(",");
    const lastPart = commaParts.at(-1) ?? "";
    normalized =
      commaParts.length === 2 && lastPart.length === 3
        ? cleaned.replaceAll(",", "")
        : cleaned.replaceAll(".", "").replace(",", ".");
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function detectCurrency(value) {
  const text = String(value ?? "").trim();
  const codeMatch = text.toUpperCase().match(/\b[A-Z]{3}\b/);

  if (codeMatch && CURRENCY_CODES.has(codeMatch[0])) {
    return codeMatch[0];
  }

  if (text.includes("€")) {
    return "EUR";
  }

  if (text.includes("₪")) {
    return "ILS";
  }

  if (text.includes("£")) {
    return "GBP";
  }

  return "USD";
}

function normalizeSymbol(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function isLikelySymbol(value) {
  return /^[A-Z0-9][A-Z0-9.\-=]{0,18}$/.test(String(value ?? "").trim().toUpperCase());
}

function isRowNumber(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}
