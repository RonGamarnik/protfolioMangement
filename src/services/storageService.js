import { getAuthHeader } from "./authService.js";

const SQL_STORAGE_ENDPOINT = "/api/portfolio";
const SQL_PORTFOLIOS_ENDPOINT = "/api/portfolios";
const SQL_SHARE_REQUESTS_ENDPOINT = "/api/portfolio-share-requests";
const ACTIVE_PORTFOLIO_KEY = "portfolio-live-active-portfolio-id";

const defaultSettings = {
  totalBudgetUsd: 10000,
  autoRefresh: true,
  refreshSeconds: 60,
  theme: "dark",
  ubsMode: false,
};

export function getActivePortfolioId() {
  return localStorage.getItem(ACTIVE_PORTFOLIO_KEY);
}

export function setActivePortfolioId(portfolioId) {
  if (portfolioId) {
    localStorage.setItem(ACTIVE_PORTFOLIO_KEY, portfolioId);
  } else {
    localStorage.removeItem(ACTIVE_PORTFOLIO_KEY);
  }
}

export async function listPortfolios() {
  const response = await fetch(SQL_PORTFOLIOS_ENDPOINT, {
    cache: "no-store",
    headers: getAuthHeader(),
  });

  if (response.status === 404) {
    return [];
  }

  await ensureOk(response, "Failed to load portfolios");

  const payload = await response.json();
  return Array.isArray(payload.portfolios) ? payload.portfolios : [];
}

export async function createPortfolio(name) {
  const response = await fetch(SQL_PORTFOLIOS_ENDPOINT, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name }),
  });

  await ensureOk(response, "Failed to create portfolio");

  const payload = await response.json();
  return payload.portfolio;
}

export async function renamePortfolio(portfolioId, name) {
  const response = await fetch(`${SQL_PORTFOLIOS_ENDPOINT}/${encodeURIComponent(portfolioId)}`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({ name }),
  });

  await ensureOk(response, "Failed to rename portfolio");

  const payload = await response.json();
  return payload.portfolio;
}

export async function deletePortfolio(portfolioId) {
  const response = await fetch(`${SQL_PORTFOLIOS_ENDPOINT}/${encodeURIComponent(portfolioId)}`, {
    method: "DELETE",
    headers: getAuthHeader(),
  });

  await ensureOk(response, "Failed to delete portfolio");
}

export async function loadPortfolioShares(portfolioId) {
  const response = await fetch(
    `${SQL_PORTFOLIOS_ENDPOINT}/${encodeURIComponent(portfolioId)}/shares`,
    {
      cache: "no-store",
      headers: getAuthHeader(),
    },
  );

  await ensureOk(response, "Failed to load portfolio shares");

  const payload = await response.json();
  return Array.isArray(payload.shares) ? payload.shares : [];
}

export async function sharePortfolio(portfolioId, { email, permission }) {
  await ensureShareRequestApiAvailable();

  const response = await fetch(
    `${SQL_PORTFOLIOS_ENDPOINT}/${encodeURIComponent(portfolioId)}/shares`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ email, permission }),
    },
  );

  await ensureOk(response, "Failed to share portfolio");

  const payload = await response.json();
  return Array.isArray(payload.shares) ? payload.shares : [];
}

export async function revokePortfolioShare(portfolioId, shareId) {
  const response = await fetch(
    `${SQL_PORTFOLIOS_ENDPOINT}/${encodeURIComponent(portfolioId)}/shares/${encodeURIComponent(shareId)}`,
    {
      method: "DELETE",
      headers: getAuthHeader(),
    },
  );

  await ensureOk(response, "Failed to revoke portfolio share");
}

export async function loadPortfolioShareRequests() {
  const response = await fetch(SQL_SHARE_REQUESTS_ENDPOINT, {
    cache: "no-store",
    headers: getAuthHeader(),
  });

  if (response.status === 404) {
    return [];
  }

  await ensureOk(response, "Failed to load portfolio share requests");

  const payload = await response.json();
  return Array.isArray(payload.requests) ? payload.requests : [];
}

export async function acceptPortfolioShareRequest(shareId) {
  const response = await fetch(
    `${SQL_SHARE_REQUESTS_ENDPOINT}/${encodeURIComponent(shareId)}/accept`,
    {
      method: "POST",
      headers: getAuthHeader(),
    },
  );

  await ensureOk(response, "Failed to accept portfolio share request");
}

export async function declinePortfolioShareRequest(shareId) {
  const response = await fetch(`${SQL_SHARE_REQUESTS_ENDPOINT}/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
    headers: getAuthHeader(),
  });

  await ensureOk(response, "Failed to decline portfolio share request");
}

export async function loadStoredState(portfolioId) {
  const response = await fetch(createPortfolioStateUrl(portfolioId), {
    cache: "no-store",
    headers: getAuthHeader(),
  });

  await ensureOk(response, "Failed to load portfolio");

  const serverState = await response.json();
  return normalizeState(serverState);
}

export async function saveStoredState({ holdings, settings, cachedMarket, portfolioId }) {
  const state = normalizeState({ holdings, settings, cachedMarket });
  const response = await fetch(createPortfolioStateUrl(portfolioId), {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify(state),
  });

  await ensureOk(response, "Failed to save portfolio");
}

export function serializePortfolio({ holdings, settings }) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      holdings,
      settings,
    },
    null,
    2,
  );
}

export function parsePortfolioImport(raw) {
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.holdings)) {
    throw new Error("Invalid portfolio file");
  }

  return {
    holdings: parsed.holdings,
    settings: {
      ...defaultSettings,
      ...(parsed.settings ?? {}),
    },
  };
}

function normalizeState(state) {
  return {
    portfolio: state?.portfolio ?? null,
    holdings: Array.isArray(state?.holdings) ? state.holdings : [],
    settings: {
      ...defaultSettings,
      ...(state?.settings ?? {}),
    },
    cachedMarket: {
      fxRate: numberOrNull(state?.cachedMarket?.fxRate),
      currencyRates:
        state?.cachedMarket?.currencyRates && typeof state.cachedMarket.currencyRates === "object"
          ? state.cachedMarket.currencyRates
          : {},
      quotes:
        state?.cachedMarket?.quotes && typeof state.cachedMarket.quotes === "object"
          ? state.cachedMarket.quotes
          : {},
      lastUpdated: state?.cachedMarket?.lastUpdated ?? null,
    },
  };
}

function createDefaultState() {
  return {
    holdings: [],
    settings: { ...defaultSettings },
    cachedMarket: {
      fxRate: null,
      currencyRates: {},
      quotes: {},
      lastUpdated: null,
    },
  };
}

function createPortfolioStateUrl(portfolioId) {
  if (!portfolioId) {
    return SQL_STORAGE_ENDPOINT;
  }

  return `${SQL_STORAGE_ENDPOINT}?portfolioId=${encodeURIComponent(portfolioId)}`;
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    ...getAuthHeader(),
  };
}

async function ensureOk(response, fallbackMessage) {
  if (response.status === 401) {
    throw new Error("Authentication required");
  }

  if (response.ok) {
    return;
  }

  let message = fallbackMessage;

  try {
    const payload = await response.json();
    message = payload.error || message;
  } catch (error) {
    // Keep the fallback message when the response is not JSON.
  }

  throw new Error(message);
}

async function ensureShareRequestApiAvailable() {
  const response = await fetch(SQL_SHARE_REQUESTS_ENDPOINT, {
    cache: "no-store",
    headers: getAuthHeader(),
  });

  if (response.status === 404) {
    throw new Error("Restart the Python server to enable approval-based sharing");
  }

  await ensureOk(response, "Failed to check portfolio sharing");
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
