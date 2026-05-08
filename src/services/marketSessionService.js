const SYMBOL_ALIASES = {
  RHM: "RHM.DE",
  LDO: "LDO.MI",
  WDEF: "WDEF.L",
};

const SESSION_LABELS = {
  pre: "Pre-Market",
  regular: "Regular Market",
  post: "After-Market",
  closed: "Market Closed",
};

const SESSION_ICONS = {
  pre: "sunrise",
  regular: "activity",
  post: "moon",
  closed: "lock",
};

const US_EXCHANGES = new Set(["ASE", "BATS", "NCM", "NGM", "NMS", "NYQ", "PCX", "PNK", "OTC", "US"]);

const MARKET_PROFILES = {
  US: {
    label: "ארה״ב",
    timezone: "America/New_York",
    supportsExtended: true,
    preStart: 4 * 60,
    regularStart: 9 * 60 + 30,
    regularEnd: 16 * 60,
    postEnd: 20 * 60,
  },
  DE: {
    label: "גרמניה",
    timezone: "Europe/Berlin",
    regularStart: 9 * 60,
    regularEnd: 17 * 60 + 30,
  },
  MI: {
    label: "איטליה",
    timezone: "Europe/Rome",
    regularStart: 9 * 60,
    regularEnd: 17 * 60 + 30,
  },
  AS: {
    label: "אמסטרדם",
    timezone: "Europe/Amsterdam",
    regularStart: 9 * 60,
    regularEnd: 17 * 60 + 30,
  },
  PA: {
    label: "פריז",
    timezone: "Europe/Paris",
    regularStart: 9 * 60,
    regularEnd: 17 * 60 + 30,
  },
  BR: {
    label: "בריסל",
    timezone: "Europe/Brussels",
    regularStart: 9 * 60,
    regularEnd: 17 * 60 + 30,
  },
  MC: {
    label: "מדריד",
    timezone: "Europe/Madrid",
    regularStart: 9 * 60,
    regularEnd: 17 * 60 + 30,
  },
  SW: {
    label: "שווייץ",
    timezone: "Europe/Zurich",
    regularStart: 9 * 60,
    regularEnd: 17 * 60 + 30,
  },
  L: {
    label: "לונדון",
    timezone: "Europe/London",
    regularStart: 8 * 60,
    regularEnd: 16 * 60 + 30,
  },
  TO: {
    label: "קנדה",
    timezone: "America/Toronto",
    regularStart: 9 * 60 + 30,
    regularEnd: 16 * 60,
  },
  V: {
    label: "קנדה",
    timezone: "America/Toronto",
    regularStart: 9 * 60 + 30,
    regularEnd: 16 * 60,
  },
};

export function createMarketSessionSnapshot(holdings, quotes = {}, now = new Date()) {
  const sessions = {};
  const refreshSymbols = [];
  let nextOpenAt = null;
  let nextTransitionAt = null;
  let refreshableCount = 0;

  holdings.forEach((holding) => {
    const requestedSymbol = normalizeSymbol(holding.symbol);
    const quote = quotes[requestedSymbol] ?? quotes[resolveMarketSymbol(requestedSymbol)] ?? null;
    const session = getMarketSession(requestedSymbol, quote, now);

    sessions[requestedSymbol] = session;

    if (session.resolvedSymbol && session.resolvedSymbol !== requestedSymbol) {
      sessions[session.resolvedSymbol] = session;
    }

    if (session.canRefresh) {
      refreshableCount += 1;
      refreshSymbols.push(requestedSymbol);
    }

    nextOpenAt = earlierDate(nextOpenAt, session.nextOpenAt);
    nextTransitionAt = earlierDate(nextTransitionAt, session.nextTransitionAt);
  });

  return {
    sessions,
    refreshSymbols: [...new Set(refreshSymbols)],
    refreshableCount,
    totalCount: holdings.length,
    allClosed: holdings.length > 0 && refreshableCount === 0,
    nextOpenAt,
    nextTransitionAt,
  };
}

export function getMarketSession(symbol, quote = null, now = new Date()) {
  const requestedSymbol = normalizeSymbol(symbol);
  const resolvedSymbol = normalizeSymbol(quote?.symbol || resolveMarketSymbol(requestedSymbol));
  const profile = inferMarketProfile(resolvedSymbol, quote);
  const session = calculateSession(profile, now);

  return {
    ...session,
    symbol: requestedSymbol,
    resolvedSymbol,
    exchangeLabel: profile.label,
    timezone: profile.timezone,
    label: SESSION_LABELS[session.status],
    icon: SESSION_ICONS[session.status],
    className: `is-${session.status}`,
  };
}

export function resolveMarketSymbol(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  return SYMBOL_ALIASES[normalizedSymbol] ?? normalizedSymbol;
}

function inferMarketProfile(symbol, quote) {
  const exchangeName = String(quote?.exchangeName ?? "").toUpperCase();

  if (US_EXCHANGES.has(exchangeName) || exchangeName.endsWith(".US")) {
    return MARKET_PROFILES.US;
  }

  const suffix = getSymbolSuffix(symbol);

  return MARKET_PROFILES[suffix] ?? MARKET_PROFILES.US;
}

function calculateSession(profile, now) {
  const local = getZonedParts(now, profile.timezone);
  const startMinute = profile.supportsExtended ? profile.preStart : profile.regularStart;

  if (!isBusinessDay(local.weekday)) {
    const nextOpenAt = findNextOpenAt(local, startMinute, profile.timezone);

    return createClosedSession(nextOpenAt);
  }

  if (
    profile.supportsExtended &&
    local.minuteOfDay >= profile.preStart &&
    local.minuteOfDay < profile.regularStart
  ) {
    return createOpenSession("pre", buildZonedDate(local, profile.regularStart, profile.timezone));
  }

  if (local.minuteOfDay >= profile.regularStart && local.minuteOfDay < profile.regularEnd) {
    return createOpenSession(
      "regular",
      buildZonedDate(
        local,
        profile.supportsExtended ? profile.regularEnd : profile.regularEnd,
        profile.timezone,
      ),
    );
  }

  if (
    profile.supportsExtended &&
    local.minuteOfDay >= profile.regularEnd &&
    local.minuteOfDay < profile.postEnd
  ) {
    return createOpenSession("post", buildZonedDate(local, profile.postEnd, profile.timezone));
  }

  const nextOpenAt = findNextOpenAt(local, startMinute, profile.timezone);
  return createClosedSession(nextOpenAt);
}

function createOpenSession(status, nextTransitionAt) {
  return {
    status,
    canRefresh: true,
    nextOpenAt: null,
    nextTransitionAt,
  };
}

function createClosedSession(nextOpenAt) {
  return {
    status: "closed",
    canRefresh: false,
    nextOpenAt,
    nextTransitionAt: nextOpenAt,
  };
}

function findNextOpenAt(local, startMinute, timezone) {
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = addLocalCalendarDays(local, offset);

    if (!isBusinessDay(day.weekday)) {
      continue;
    }

    if (offset === 0 && local.minuteOfDay >= startMinute) {
      continue;
    }

    return buildZonedDate(day, startMinute, timezone);
  }

  return null;
}

function getZonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = normalizeHour(Number(byType.hour));
  const minute = Number(byType.minute);

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    weekday: weekdayToNumber(byType.weekday),
    hour,
    minute,
    second: Number(byType.second),
    minuteOfDay: hour * 60 + minute,
  };
}

function buildZonedDate(local, minuteOfDay, timezone) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const naiveUtc = Date.UTC(local.year, local.month - 1, local.day, hour, minute, 0);
  const firstPass = new Date(naiveUtc - getTimeZoneOffset(new Date(naiveUtc), timezone));
  const secondPass = new Date(naiveUtc - getTimeZoneOffset(firstPass, timezone));

  return secondPass;
}

function getTimeZoneOffset(date, timezone) {
  const local = getZonedParts(date, timezone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );

  return asUtc - date.getTime();
}

function addLocalCalendarDays(local, offset) {
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day + offset, 12, 0, 0));

  return {
    ...local,
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
    weekday: next.getUTCDay(),
  };
}

function earlierDate(current, next) {
  if (!next) {
    return current;
  }

  if (!current || next.getTime() < current.getTime()) {
    return next;
  }

  return current;
}

function getSymbolSuffix(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  return normalizedSymbol.includes(".") ? normalizedSymbol.split(".").at(-1) : "";
}

function isBusinessDay(weekday) {
  return weekday >= 1 && weekday <= 5;
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase();
}

function normalizeHour(hour) {
  return hour === 24 ? 0 : hour;
}

function weekdayToNumber(value) {
  const weekdays = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return weekdays[value] ?? 0;
}
