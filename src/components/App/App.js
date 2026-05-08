import { loadTemplate } from "../../lib/template.js";
import { query, refreshIcons } from "../../lib/dom.js";
import {
  acceptPortfolioShareRequest,
  createPortfolio,
  declinePortfolioShareRequest,
  deletePortfolio as deleteStoredPortfolio,
  getActivePortfolioId,
  listPortfolios,
  loadPortfolioShares,
  loadPortfolioShareRequests,
  loadStoredState,
  revokePortfolioShare,
  saveStoredState,
  setActivePortfolioId,
  sharePortfolio as shareStoredPortfolio,
} from "../../services/storageService.js";
import { logoutUser } from "../../services/authService.js";
import {
  fetchCurrencyRateToUsd,
  fetchMarketSnapshot,
  fetchQuote,
} from "../../services/marketService.js";
import { requestPortfolioInsights } from "../../services/aiService.js";
import {
  createMarketSessionSnapshot,
  getMarketSession,
  resolveMarketSymbol,
} from "../../services/marketSessionService.js";
import {
  calculatePortfolio,
  createHolding,
  upsertHolding,
} from "../../services/portfolioService.js";
import { renderHeader } from "../Header/Header.js";
import { renderMarketRibbon } from "../MarketRibbon/MarketRibbon.js";
import { renderSummaryCards } from "../SummaryCards/SummaryCards.js";
import { createPortfolioForm } from "../PortfolioForm/PortfolioForm.js";
import { createAllocationPlanner } from "../AllocationPlanner/AllocationPlanner.js";
import { createExcelImport } from "../ExcelImport/ExcelImport.js";
import { createExposureInsights } from "../ExposureInsights/ExposureInsights.js";
import { createPortfolioShare } from "../PortfolioShare/PortfolioShare.js";
import { createPortfolioRequests } from "../PortfolioRequests/PortfolioRequests.js";
import { createPortfolioManage } from "../PortfolioManage/PortfolioManage.js";
import { createPortfolioIntelligence } from "../PortfolioIntelligence/PortfolioIntelligence.js";
import { renderSettingsPanel } from "../SettingsPanel/SettingsPanel.js";
import { renderHoldingsTable } from "../HoldingsTable/HoldingsTable.js";
import { createToast } from "../Toast/Toast.js";

export async function mountApp(root, options = {}) {
  if (!root) {
    throw new Error("Root element not found");
  }

  const template = await loadTemplate(new URL("./App.html", import.meta.url));
  root.innerHTML = template;

  const portfolioItems = await listPortfolios();
  const shareRequests = portfolioItems.length ? await loadPortfolioShareRequests() : [];
  const activePortfolio = chooseActivePortfolio(portfolioItems);
  const storedState = await loadStoredState(activePortfolio?.id);
  const normalizedActivePortfolio =
    storedState.portfolio ??
    activePortfolio ??
    portfolioItems[0] ??
    createLegacyPortfolio(storedState.holdings);

  if (normalizedActivePortfolio?.id) {
    setActivePortfolioId(normalizedActivePortfolio.id);
  }

  const state = {
    user: options.user ?? null,
    portfolios: {
      items: syncPortfolioList(portfolioItems, normalizedActivePortfolio),
      activeId: normalizedActivePortfolio?.id ?? null,
      shares: [],
      shareRequests,
      isLoading: false,
      managementAvailable: portfolioItems.length > 0 || Boolean(storedState.portfolio),
    },
    holdings: sanitizeHoldings(storedState.holdings),
    settings: storedState.settings,
    ui: {
      holdingOpen: false,
      allocationOpen: false,
      excelImportOpen: false,
      exposureOpen: false,
      settingsOpen: false,
      portfolioShareOpen: false,
      portfolioRequestsOpen: false,
      portfolioManageOpen: false,
      portfolioIntelligenceOpen: false,
      holdingsSort: "symbol-asc",
    },
    intelligence: {
      ai: null,
      isLoading: false,
      error: "",
    },
    quotes: normalizeCachedQuotes(storedState.cachedMarket.quotes, storedState.holdings),
    market: {
      isLoading: false,
      lastUpdated: storedState.cachedMarket.lastUpdated,
      fxRate: storedState.cachedMarket.fxRate,
      currencyRates: {
        USD: 1,
        ...(storedState.cachedMarket.fxRate ? { ILS: 1 / storedState.cachedMarket.fxRate } : {}),
        ...(storedState.cachedMarket.currencyRates ?? {}),
      },
      fxSource: null,
      errors: [],
      sourceLabel: "--",
      sessions: {},
      refreshSymbols: [],
      closedFallbackAttempted: new Set(),
      refreshableCount: 0,
      nextMarketOpenAt: null,
      nextMarketTransitionAt: null,
    },
  };

  const refs = {
    toast: query(root, '[data-component="Toast"]'),
    header: query(root, '[data-component="Header"]'),
    marketRibbon: query(root, '[data-component="MarketRibbon"]'),
    summaryCards: query(root, '[data-component="SummaryCards"]'),
    portfolioForm: query(root, '[data-component="PortfolioForm"]'),
    allocationPlanner: query(root, '[data-component="AllocationPlanner"]'),
    exposureInsights: query(root, '[data-component="ExposureInsights"]'),
    settingsPanel: query(root, '[data-component="SettingsPanel"]'),
    settingsModal: query(root, '[data-component="SettingsModal"]'),
    holdingModal: query(root, '[data-component="HoldingModal"]'),
    allocationModal: query(root, '[data-component="AllocationModal"]'),
    excelImportModal: query(root, '[data-component="ExcelImportModal"]'),
    exposureModal: query(root, '[data-component="ExposureModal"]'),
    portfolioShareModal: query(root, '[data-component="PortfolioShareModal"]'),
    portfolioRequestsModal: query(root, '[data-component="PortfolioRequestsModal"]'),
    portfolioManageModal: query(root, '[data-component="PortfolioManageModal"]'),
    portfolioIntelligenceModal: query(root, '[data-component="PortfolioIntelligenceModal"]'),
    holdingsTable: query(root, '[data-component="HoldingsTable"]'),
    excelImport: query(root, '[data-component="ExcelImport"]'),
    portfolioShare: query(root, '[data-component="PortfolioShare"]'),
    portfolioRequests: query(root, '[data-component="PortfolioRequests"]'),
    portfolioManage: query(root, '[data-component="PortfolioManage"]'),
    portfolioIntelligence: query(root, '[data-component="PortfolioIntelligence"]'),
  };

  const toast = await createToast(refs.toast);
  let autoRefreshTimer = null;
  let formController = null;
  let allocationController = null;
  let excelImportController = null;
  let exposureController = null;
  let portfolioShareController = null;
  let portfolioRequestsController = null;
  let portfolioManageController = null;
  let portfolioIntelligenceController = null;
  let dashboardIconsReady = false;

  const actions = {
    refreshMarket,
    clearPortfolio,
    editHolding,
    deleteHolding,
    submitHolding,
    useCurrentPrice,
    applyAllocation,
    applyExcelImport,
    createNewPortfolio,
    deleteActivePortfolio,
    switchPortfolio,
    openPortfolioShare,
    closePortfolioShare,
    shareActivePortfolio,
    revokeActivePortfolioShare,
    openPortfolioRequests,
    closePortfolioRequests,
    acceptPortfolioRequest,
    declinePortfolioRequest,
    openPortfolioManage,
    closePortfolioManage,
    openPortfolioIntelligence,
    closePortfolioIntelligence,
    generatePortfolioAiInsights,
    updateHoldingsSort,
    updateSettings,
    toggleUbsMode,
    openHoldingForm,
    closeHoldingForm,
    openAllocationEditor,
    closeAllocationEditor,
    openExcelImport,
    closeExcelImport,
    openExposureInsights,
    closeExposureInsights,
    openSettings,
    closeSettings,
    logout,
  };

  formController = await createPortfolioForm(refs.portfolioForm, actions);
  allocationController = await createAllocationPlanner(refs.allocationPlanner, actions, state.settings);
  excelImportController = await createExcelImport(refs.excelImport, actions);
  exposureController = await createExposureInsights(refs.exposureInsights, actions);
  portfolioShareController = await createPortfolioShare(refs.portfolioShare, actions);
  portfolioRequestsController = await createPortfolioRequests(refs.portfolioRequests, actions);
  portfolioManageController = await createPortfolioManage(refs.portfolioManage, actions);
  portfolioIntelligenceController = await createPortfolioIntelligence(refs.portfolioIntelligence, actions);
  bindStaticActions(root);
  applyTheme(state.settings.theme);
  if (!state.holdings.length) {
    openAllocationEditor();
  }

  await renderSettings();
  await renderDashboard();
  startAutoRefresh();

  if (state.holdings.length) {
    await refreshMarket({ silent: true });
  }

  function getComputedPortfolio() {
    updateMarketSessions();
    const computed = calculatePortfolio(
      state.holdings,
      state.quotes,
      state.market.fxRate,
      state.market.currencyRates,
      {
        ubsMode: state.settings.ubsMode,
        marketSessions: state.market.sessions,
      },
    );

    return {
      ...computed,
      rows: computed.rows.map((row) => ({
        ...row,
        marketSession: findMarketSession(row),
      })),
    };
  }

  function getActivePortfolio() {
    return state.portfolios.items.find((portfolio) => portfolio.id === state.portfolios.activeId) ?? null;
  }

  function canEditActivePortfolio() {
    const portfolio = getActivePortfolio();
    return !portfolio || portfolio.permission === "EDIT";
  }

  function canManageActivePortfolio() {
    return getActivePortfolio()?.role === "OWNER";
  }

  function requirePortfolioEdit() {
    if (canEditActivePortfolio()) {
      return true;
    }

    toast.show("View-only shared portfolios cannot be edited", "warning");
    return false;
  }

  async function renderDashboard({ includeTable = true } = {}) {
    const computed = getComputedPortfolio();

    const renderTasks = [
      renderHeader(refs.header, state, actions),
      renderMarketRibbon(refs.marketRibbon, state),
      renderSummaryCards(refs.summaryCards, computed, state, actions),
    ];

    if (includeTable) {
      renderTasks.push(
        renderHoldingsTable(
          refs.holdingsTable,
          {
            ...computed,
            rows: sortHoldingRows(computed.rows, state.ui.holdingsSort),
          },
          actions,
          { sortKey: state.ui.holdingsSort },
        ),
      );
    }

    await Promise.all(renderTasks);

    syncPortfolioActionState();
    syncModalVisibility();

    if (!dashboardIconsReady) {
      refreshIcons();
      dashboardIconsReady = true;
    }
  }

  async function renderSettings() {
    await renderSettingsPanel(refs.settingsPanel, state, actions);
    syncModalVisibility();
    refreshIcons();
  }

  async function refreshMarket({ silent = false } = {}) {
    if (!state.holdings.length || state.market.isLoading) {
      return;
    }

    updateMarketSessions();
    const closedFallbackSymbols = getClosedMissingQuoteSymbols();
    const refreshSymbols = [
      ...new Set([...state.market.refreshSymbols, ...closedFallbackSymbols]),
    ];

    if (!refreshSymbols.length) {
      state.market.errors = [];
      state.market.sourceLabel = state.market.nextMarketOpenAt
        ? `אין קריאות עד פתיחה: ${formatShortDateTime(state.market.nextMarketOpenAt)}`
        : "השוק סגור";
      if (canEditActivePortfolio()) {
        await persist();
      }
      await renderDashboard();
      startAutoRefresh();

      if (!silent) {
        toast.show("השוק סגור כרגע, הרענון הבא יופעל כשהמסחר ייפתח", "warning");
      }

      return;
    }

    state.market.isLoading = true;
    state.market.errors = [];
    await renderMarketRibbon(refs.marketRibbon, state);

    try {
      const snapshot = await fetchMarketSnapshot(
        refreshSymbols,
        state.holdings
          .filter((holding) => refreshSymbols.includes(holding.symbol))
          .map((holding) => holding.buyCurrency),
      );
      closedFallbackSymbols.forEach((symbol) => {
        markClosedFallbackAttempted(symbol, snapshot.quotes[symbol]);
      });
      state.quotes = mergeMarketQuotes(state.quotes, snapshot.quotes);
      state.market.fxRate = snapshot.fxRate ?? state.market.fxRate;
      state.market.currencyRates = {
        ...state.market.currencyRates,
        ...snapshot.currencyRates,
      };
      reconcileForeignBuyCurrencies(snapshot.quotes, state.market.currencyRates);
      state.market.fxSource = snapshot.fxSource;
      state.market.lastUpdated = snapshot.updatedAt;
      state.market.errors = snapshot.errors;
      state.market.sourceLabel = createSourceLabel(snapshot);
      updateMarketSessions();
      if (canEditActivePortfolio()) {
        await persist();
      }

      if (!silent) {
        const failedCount = snapshot.errors.length;
        toast.show(
          failedCount
            ? `הנתונים עודכנו, ${failedCount} סימולים לא נטענו`
            : "נתוני השוק עודכנו",
          failedCount ? "warning" : "success",
        );
      }
    } catch (error) {
      state.market.errors = [{ symbol: "MARKET", message: error.message }];
      toast.show(error.message, "error");
    } finally {
      state.market.isLoading = false;
      await renderDashboard();
      startAutoRefresh();
    }
  }

  async function submitHolding(input) {
    if (!requirePortfolioEdit()) {
      return;
    }

    try {
      const quote = await resolveQuote(input.symbol);
      const currencyDecision = await resolveBuyCurrency(input, quote);
      const holding = createHolding({
        ...input,
        symbol: quote.symbol,
        buyCurrency: currencyDecision.buyCurrency,
        currencyRateToUsd: currencyDecision.currencyRateToUsd,
      });
      state.holdings = upsertHolding(state.holdings, holding);
      await persist();
      formController.reset();
      closeHoldingForm();
      toast.show("האחזקה נשמרה", "success");
      await renderDashboard();
      refreshMarket({ silent: true });
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  async function useCurrentPrice(symbol) {
    try {
      const normalizedSymbol = String(symbol ?? "").trim().toUpperCase();
      const cachedQuote = getCachedQuote(normalizedSymbol);
      const session = getMarketSession(normalizedSymbol, cachedQuote);

      if (!session.canRefresh && hasUsableCachedQuote(normalizedSymbol)) {
        return cachedQuote;
      }

      if (!session.canRefresh && state.market.closedFallbackAttempted.has(normalizedSymbol)) {
        toast.show("השוק סגור כרגע, לא מתבצעת קריאת מחיר עד הפתיחה", "warning");
        return null;
      }

      const quote = await fetchQuote(normalizedSymbol);
      state.quotes[quote.symbol] = quote;
      state.quotes[normalizedSymbol] = quote;

      if (!session.canRefresh) {
        markClosedFallbackAttempted(normalizedSymbol, quote);

        if (canEditActivePortfolio()) {
          await persist();
        }
      }

      return quote;
    } catch (error) {
      toast.show(error.message, "error");
      return null;
    }
  }

  async function applyAllocation({ totalBudgetUsd, rows }) {
    if (!requirePortfolioEdit()) {
      return;
    }

    try {
      const nextHoldings = await createHoldingsFromAllocation(totalBudgetUsd, rows);
      state.holdings = nextHoldings;
      state.settings.totalBudgetUsd = Number(totalBudgetUsd);
      await persist();
      closeAllocationEditor();
      toast.show("התיק נבנה לפי החלוקה", "success");
      await renderDashboard();
      refreshMarket({ silent: true });
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  async function applyExcelImport({ rows }) {
    if (!requirePortfolioEdit()) {
      return;
    }

    try {
      const cleanRows = Array.isArray(rows) ? rows : [];

      if (!cleanRows.length) {
        throw new Error("אין שורות תקינות לייבוא");
      }

      const ratesByCurrency = await loadImportCurrencyRates(cleanRows);
      const importedHoldings = cleanRows.map((row) => {
        const currency = normalizeCurrency(row.currency);
        const rate = ratesByCurrency.get(currency);

        if (!rate) {
          throw new Error(`לא נמצא שער מטבע עבור ${currency}`);
        }

        return createHolding({
          symbol: row.symbol,
          investmentUsd: Number(row.price) * Number(row.quantity) * rate.value,
          buyPrice: row.price,
          buyCurrency: rate.currency,
          currencyRateToUsd: rate.value,
        });
      });

      state.holdings = importedHoldings.reduce(
        (holdings, holding) => upsertHolding(holdings, holding),
        state.holdings,
      );
      await persist();
      closeExcelImport();
      excelImportController.reset();
      toast.show(`${importedHoldings.length} אחזקות נוספו מהאקסל`, "success");
      await renderDashboard();
      refreshMarket({ silent: true });
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  function editHolding(id) {
    const holding = state.holdings.find((item) => item.id === id);

    if (holding) {
      formController.loadHolding(holding);
      state.ui.holdingOpen = true;
      syncModalVisibility();
    }
  }

  async function deleteHolding(id) {
    if (!requirePortfolioEdit()) {
      return;
    }

    const holding = state.holdings.find((item) => item.id === id);

    if (!holding) {
      return;
    }

    const confirmed = window.confirm(`למחוק את ${holding.symbol} מהתיק?`);

    if (!confirmed) {
      return;
    }

    state.holdings = state.holdings.filter((item) => item.id !== id);
    await persist();
    toast.show("האחזקה נמחקה", "success");
    await renderDashboard();
  }

  async function clearPortfolio() {
    if (!requirePortfolioEdit()) {
      return;
    }

    const confirmed = window.confirm("למחוק את כל התיק? הפעולה תמחק את כל האחזקות מהחשבון.");

    if (!confirmed) {
      return;
    }

    state.holdings = [];
    state.quotes = {};
    state.market.errors = [];
    await persist();
    formController.reset();
    allocationController.loadHoldings([], state.settings.totalBudgetUsd);
    toast.show("התיק נוקה", "success");
    await renderDashboard();
    openAllocationEditor();
  }

  async function updateSettings(nextSettings) {
    if (!requirePortfolioEdit()) {
      return;
    }

    state.settings = {
      ...state.settings,
      ...nextSettings,
    };
    applyTheme(state.settings.theme);
    await persist();
    await renderSettings();
    await renderDashboard();
    startAutoRefresh();
  }

  async function toggleUbsMode() {
    await updateSettings({ ubsMode: !state.settings.ubsMode });
    toast.show(state.settings.ubsMode ? "UBS Mode active" : "UBS Mode off", "success");
  }

  async function createNewPortfolio() {
    if (state.portfolios.managementAvailable === false) {
      toast.show("צריך להפעיל מחדש את שרת Python כדי לאפשר כמה תיקים", "warning");
      return;
    }

    const name = window.prompt("Portfolio name", "New Portfolio");

    if (!name || !name.trim()) {
      return;
    }

    try {
      const portfolio = await createPortfolio(name.trim());
      state.portfolios.items = syncPortfolioList(state.portfolios.items, portfolio);
      await switchPortfolio(portfolio.id);
      toast.show("Portfolio created", "success");
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  async function deleteActivePortfolio() {
    const portfolio = getActivePortfolio();

    if (!portfolio) {
      toast.show("No active portfolio selected", "warning");
      return;
    }

    const isShared = portfolio.role === "SHARED";
    const ownedCount = state.portfolios.items.filter((item) => item.role === "OWNER").length;

    if (!isShared && ownedCount <= 1) {
      toast.show("You cannot delete your only owned portfolio", "warning");
      return;
    }

    const confirmed = window.confirm(
      isShared
        ? `Remove ${portfolio.name} from your account?`
        : `Delete ${portfolio.name}?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      await deleteStoredPortfolio(portfolio.id);
      const portfolios = await listPortfolios();
      const nextPortfolio = chooseActivePortfolio(portfolios);
      state.portfolios.items = portfolios;
      state.ui.portfolioManageOpen = false;
      await switchPortfolio(nextPortfolio?.id);
      toast.show(isShared ? "Shared portfolio removed" : "Portfolio deleted", "success");
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  async function switchPortfolio(portfolioId) {
    if (!portfolioId || portfolioId === state.portfolios.activeId || state.portfolios.isLoading) {
      return;
    }

    state.portfolios.isLoading = true;

    if (autoRefreshTimer) {
      window.clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }

    try {
      const stored = await loadStoredState(portfolioId);
      const portfolios = await listPortfolios();
      const active = stored.portfolio ?? portfolios.find((portfolio) => portfolio.id === portfolioId) ?? null;

      applyStoredState(stored);
      state.portfolios.items = syncPortfolioList(portfolios, active);
      state.portfolios.activeId = active?.id ?? portfolioId;
      state.portfolios.shares = [];
      state.portfolios.managementAvailable = portfolios.length > 0 || Boolean(stored.portfolio);
      setActivePortfolioId(state.portfolios.activeId);
      applyTheme(state.settings.theme);
      closeAllEditingModals();
      await renderSettings();
      await renderDashboard();
      startAutoRefresh();

      if (state.holdings.length) {
        refreshMarket({ silent: true });
      }
    } catch (error) {
      toast.show(error.message, "error");
    } finally {
      state.portfolios.isLoading = false;
      await renderDashboard({ includeTable: false });
    }
  }

  async function openPortfolioShare() {
    const portfolio = getActivePortfolio();

    if (state.portfolios.managementAvailable === false) {
      toast.show("צריך להפעיל מחדש את שרת Python כדי לאפשר שיתוף תיקים", "warning");
      return;
    }

    if (!portfolio || !canManageActivePortfolio()) {
      toast.show("Only the owner can share this portfolio", "warning");
      return;
    }

    try {
      state.portfolios.shares = await loadPortfolioShares(portfolio.id);
      state.ui.portfolioShareOpen = true;
      await renderPortfolioShare();
      syncModalVisibility();
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  function closePortfolioShare() {
    state.ui.portfolioShareOpen = false;
    syncModalVisibility();
  }

  async function shareActivePortfolio(input) {
    const portfolio = getActivePortfolio();

    if (!portfolio || !canManageActivePortfolio()) {
      toast.show("Only the owner can share this portfolio", "warning");
      return;
    }

    try {
      state.portfolios.shares = await shareStoredPortfolio(portfolio.id, input);
      portfolioShareController.reset();
      await renderPortfolioShare();
      toast.show("Portfolio request sent", "success");
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  async function revokeActivePortfolioShare(shareId) {
    const portfolio = getActivePortfolio();

    if (!portfolio || !canManageActivePortfolio()) {
      toast.show("Only the owner can manage sharing", "warning");
      return;
    }

    try {
      await revokePortfolioShare(portfolio.id, shareId);
      state.portfolios.shares = await loadPortfolioShares(portfolio.id);
      await renderPortfolioShare();
      toast.show("Share removed", "success");
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  async function openPortfolioRequests() {
    if (state.portfolios.managementAvailable === false) {
      toast.show("צריך להפעיל מחדש את שרת Python כדי לאפשר בקשות שיתוף", "warning");
      return;
    }

    try {
      state.portfolios.shareRequests = await loadPortfolioShareRequests();
      state.ui.portfolioRequestsOpen = true;
      await renderPortfolioRequests();
      syncModalVisibility();
      await renderDashboard({ includeTable: false });
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  function closePortfolioRequests() {
    state.ui.portfolioRequestsOpen = false;
    syncModalVisibility();
  }

  async function acceptPortfolioRequest(shareId) {
    try {
      await acceptPortfolioShareRequest(shareId);
      state.portfolios.shareRequests = await loadPortfolioShareRequests();
      state.portfolios.items = await listPortfolios();
      const preferredPortfolio = chooseActivePortfolio(state.portfolios.items);
      state.portfolios.activeId = preferredPortfolio?.id ?? state.portfolios.activeId;
      setActivePortfolioId(state.portfolios.activeId);
      await renderPortfolioRequests();
      await renderDashboard({ includeTable: false });
      toast.show("Portfolio request accepted", "success");
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  async function declinePortfolioRequest(shareId) {
    try {
      await declinePortfolioShareRequest(shareId);
      state.portfolios.shareRequests = await loadPortfolioShareRequests();
      await renderPortfolioRequests();
      await renderDashboard({ includeTable: false });
      toast.show("Portfolio request declined", "success");
    } catch (error) {
      toast.show(error.message, "error");
    }
  }

  async function openPortfolioManage() {
    if (state.portfolios.managementAvailable === false) {
      toast.show("צריך להפעיל מחדש את שרת Python כדי לאפשר ניהול תיקים", "warning");
      return;
    }

    state.ui.portfolioManageOpen = true;
    await renderPortfolioManage();
    syncModalVisibility();
  }

  function closePortfolioManage() {
    state.ui.portfolioManageOpen = false;
    syncModalVisibility();
  }

  async function openPortfolioIntelligence() {
    if (!state.holdings.length) {
      toast.show("Add holdings before running portfolio intelligence", "warning");
      return;
    }

    state.ui.portfolioIntelligenceOpen = true;
    await renderPortfolioIntelligence();
    syncModalVisibility();
  }

  function closePortfolioIntelligence() {
    state.ui.portfolioIntelligenceOpen = false;
    syncModalVisibility();
  }

  async function generatePortfolioAiInsights() {
    if (state.intelligence.isLoading) {
      return;
    }

    state.intelligence.isLoading = true;
    state.intelligence.error = "";
    await renderPortfolioIntelligence();

    try {
      const computed = getComputedPortfolio();
      state.intelligence.ai = await requestPortfolioInsights(
        createPortfolioInsightPayload(computed, getActivePortfolio()),
      );
    } catch (error) {
      state.intelligence.error = error.message;
      toast.show(error.message, "error");
    } finally {
      state.intelligence.isLoading = false;
      await renderPortfolioIntelligence();
    }
  }

  async function updateHoldingsSort(sortKey) {
    state.ui.holdingsSort = normalizeSortKey(sortKey);
    await renderDashboard();
  }

  function applyStoredState(stored) {
    state.holdings = sanitizeHoldings(stored.holdings);
    state.settings = stored.settings;
    state.quotes = normalizeCachedQuotes(stored.cachedMarket.quotes, stored.holdings);
    state.market = {
      ...state.market,
      isLoading: false,
      lastUpdated: stored.cachedMarket.lastUpdated,
      fxRate: stored.cachedMarket.fxRate,
      currencyRates: {
        USD: 1,
        ...(stored.cachedMarket.fxRate ? { ILS: 1 / stored.cachedMarket.fxRate } : {}),
        ...(stored.cachedMarket.currencyRates ?? {}),
      },
      fxSource: null,
      errors: [],
      sourceLabel: "--",
      sessions: {},
      refreshSymbols: [],
      closedFallbackAttempted: new Set(),
      refreshableCount: 0,
      nextMarketOpenAt: null,
      nextMarketTransitionAt: null,
    };
  }

  function closeAllEditingModals() {
    state.ui.holdingOpen = false;
    state.ui.allocationOpen = false;
    state.ui.excelImportOpen = false;
    state.ui.exposureOpen = false;
    state.ui.settingsOpen = false;
    state.ui.portfolioShareOpen = false;
    state.ui.portfolioRequestsOpen = false;
    state.ui.portfolioManageOpen = false;
    state.ui.portfolioIntelligenceOpen = false;
  }

  async function renderPortfolioShare() {
    await portfolioShareController.render({
      portfolio: getActivePortfolio(),
      shares: state.portfolios.shares,
      canManage: canManageActivePortfolio(),
    });
    refreshIcons();
  }

  async function renderPortfolioRequests() {
    await portfolioRequestsController.render({
      requests: state.portfolios.shareRequests,
    });
    refreshIcons();
  }

  async function renderPortfolioManage() {
    const portfolio = getActivePortfolio();
    const ownedCount = state.portfolios.items.filter((item) => item.role === "OWNER").length;
    const canDelete = portfolio?.role === "SHARED" || ownedCount > 1;

    await portfolioManageController.render({
      portfolio,
      canDelete,
    });
    refreshIcons();
  }

  async function renderPortfolioIntelligence() {
    portfolioIntelligenceController.render({
      computed: getComputedPortfolio(),
      portfolio: getActivePortfolio(),
      ai: state.intelligence.ai,
      isLoading: state.intelligence.isLoading,
      error: state.intelligence.error,
    });
    refreshIcons();
  }

  function syncPortfolioActionState() {
    const canEdit = canEditActivePortfolio();

    root
      .querySelectorAll("[data-requires-portfolio-edit]")
      .forEach((element) => {
        element.disabled = !canEdit;
        element.title = canEdit ? element.dataset.defaultTitle || "" : "View-only portfolio";
      });
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) {
      window.clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }

    if (!state.settings.autoRefresh) {
      return;
    }

    updateMarketSessions();

    const refreshDelay = state.settings.refreshSeconds * 1000;
    const transitionDelay = millisecondsUntil(state.market.nextMarketTransitionAt);
    const nextDelay =
      state.market.refreshSymbols.length === 0 && transitionDelay
        ? transitionDelay
        : Math.min(refreshDelay, transitionDelay || refreshDelay);

    autoRefreshTimer = window.setTimeout(() => {
      autoRefreshTimer = null;
      refreshMarket({ silent: true });
    }, Math.max(5000, nextDelay));
  }

  function openSettings() {
    if (!requirePortfolioEdit()) {
      return;
    }

    state.ui.settingsOpen = true;
    syncModalVisibility();
  }

  function closeSettings() {
    state.ui.settingsOpen = false;
    syncModalVisibility();
  }

  function openHoldingForm() {
    if (!requirePortfolioEdit()) {
      return;
    }

    formController.reset();
    state.ui.holdingOpen = true;
    syncModalVisibility();
  }

  function closeHoldingForm() {
    state.ui.holdingOpen = false;
    formController.reset();
    syncModalVisibility();
  }

  function openAllocationEditor() {
    if (!requirePortfolioEdit()) {
      return;
    }

    const computed = getComputedPortfolio();
    allocationController.loadHoldings(state.holdings, state.settings.totalBudgetUsd, computed.rows);
    state.ui.allocationOpen = true;
    syncModalVisibility();
  }

  function closeAllocationEditor() {
    state.ui.allocationOpen = false;
    syncModalVisibility();
  }

  function openExcelImport() {
    if (!requirePortfolioEdit()) {
      return;
    }

    state.ui.excelImportOpen = true;
    syncModalVisibility();
    excelImportController.focusPaste();
  }

  function closeExcelImport() {
    state.ui.excelImportOpen = false;
    syncModalVisibility();
  }

  function openExposureInsights() {
    exposureController.render(getComputedPortfolio());
    state.ui.exposureOpen = true;
    syncModalVisibility();
  }

  function closeExposureInsights() {
    state.ui.exposureOpen = false;
    syncModalVisibility();
  }

  async function logout() {
    if (autoRefreshTimer) {
      window.clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }

    await logoutUser();
    options.onLogout?.();
  }

  async function persist() {
    await saveStoredState({
      holdings: state.holdings,
      settings: state.settings,
      cachedMarket: {
        fxRate: state.market.fxRate,
        currencyRates: state.market.currencyRates,
        quotes: createCachedQuotes(state.quotes, state.holdings),
        lastUpdated: state.market.lastUpdated,
      },
      portfolioId: state.portfolios.activeId,
    });
  }

  async function resolveQuote(symbol) {
    const normalizedSymbol = String(symbol ?? "").trim().toUpperCase();

    if (state.quotes[normalizedSymbol]) {
      return state.quotes[normalizedSymbol];
    }

    const resolvedSymbol = resolveMarketSymbol(normalizedSymbol);

    if (state.quotes[resolvedSymbol]) {
      return state.quotes[resolvedSymbol];
    }

    const session = getMarketSession(normalizedSymbol, null);

    if (!session.canRefresh && state.market.closedFallbackAttempted.has(normalizedSymbol)) {
      return {
        symbol: resolvedSymbol,
        currency: inferCurrencyFromSymbol(resolvedSymbol),
        exchangeName: "",
      };
    }

    const quote = await fetchQuote(normalizedSymbol);
    state.quotes[quote.symbol] = quote;
    state.quotes[normalizedSymbol] = quote;
    if (!session.canRefresh) {
      markClosedFallbackAttempted(normalizedSymbol, quote);
    }
    return quote;
  }

  async function resolveBuyCurrency(input, quote) {
    const quoteCurrency = normalizeCurrency(quote?.currency ?? "USD");
    const shouldAsk = shouldAskForForeignCurrency(quote);
    let buyCurrency = normalizeCurrency(input.buyCurrency ?? "USD");

    if (shouldAsk) {
      const useMarketCurrency = window.confirm(
        `זיהיתי שהנייר ${quote.symbol} לא נסחר בבורסה אמריקאית ומטבע המסחר שלו הוא ${quoteCurrency}.\n\nהאם מחיר הקנייה שהזנת הוא ב-${quoteCurrency}?\n\nאישור: המחיר ב-${quoteCurrency}\nביטול: המחיר בדולר`,
      );
      buyCurrency = useMarketCurrency ? quoteCurrency : "USD";
    }

    const rate = await fetchCurrencyRateToUsd(buyCurrency, state.market.fxRate);
    state.market.currencyRates = {
      ...state.market.currencyRates,
      [rate.currency]: rate.value,
    };

    return {
      buyCurrency: rate.currency,
      currencyRateToUsd: rate.value,
    };
  }

  function reconcileForeignBuyCurrencies(quotes, currencyRates) {
    let changed = false;

    state.holdings = state.holdings.map((holding) => {
      const quote = quotes[holding.symbol];
      const quoteCurrency = normalizeCurrency(quote?.currency ?? "USD");

      if (
        normalizeCurrency(holding.buyCurrency) !== "USD" ||
        quoteCurrency === "USD" ||
        !quote ||
        isUsListedQuote(quote)
      ) {
        return holding;
      }

      const rate = Number(currencyRates[quoteCurrency]);

      if (!Number.isFinite(rate) || rate <= 0) {
        return holding;
      }

      changed = true;
      state.quotes[quote.symbol || holding.symbol] = quote;

      return {
        ...holding,
        symbol: quote.symbol || holding.symbol,
        buyCurrency: quoteCurrency,
        buyCurrencyToUsd: rate,
        shares: roundShares(Number(holding.investmentUsd) / (Number(holding.buyPrice) * rate)),
      };
    });

    if (changed) {
      toast.show("מטבעות קנייה לניירות מחוץ לארה״ב עודכנו לפי מטבע המסחר", "success");
    }
  }

  async function createHoldingsFromAllocation(totalBudgetUsd, rows) {
    const total = Number(totalBudgetUsd);

    if (!Number.isFinite(total) || total <= 0) {
      throw new Error("סכום כולל חייב להיות גדול מאפס");
    }

    const cleanRows = rows
      .map((row) => ({
        symbol: String(row.symbol ?? "").trim().toUpperCase(),
        percent: Number(row.percent),
        buyPrice: Number(row.buyPrice),
      }))
      .filter((row) => row.symbol || row.percent || row.buyPrice);

    if (!cleanRows.length) {
      throw new Error("צריך לפחות מנייה אחת לחלוקה");
    }

    const percentTotal = cleanRows.reduce(
      (sum, row) => sum + (Number.isFinite(row.percent) ? row.percent : 0),
      0,
    );

    if (Math.abs(percentTotal - 100) > 0.01) {
      throw new Error("סך האחוזים חייב להיות 100%");
    }

    const holdings = [];

    for (const row of cleanRows) {
      if (!row.symbol || !Number.isFinite(row.percent) || row.percent <= 0) {
        throw new Error("כל שורה חייבת לכלול סימול ואחוז תקין");
      }

      if (!Number.isFinite(row.buyPrice) || row.buyPrice <= 0) {
        throw new Error(`מחיר קנייה לא תקין עבור ${row.symbol}`);
      }

      const quote = await resolveQuote(row.symbol);
      const buyCurrency = shouldAskForForeignCurrency(quote)
        ? normalizeCurrency(quote.currency)
        : "USD";
      const rate = await fetchCurrencyRateToUsd(buyCurrency, state.market.fxRate);
      state.market.currencyRates = {
        ...state.market.currencyRates,
        [rate.currency]: rate.value,
      };

      holdings.push(
        createHolding({
          symbol: quote.symbol,
          investmentUsd: (total * row.percent) / 100,
          buyPrice: row.buyPrice,
          buyCurrency: rate.currency,
          currencyRateToUsd: rate.value,
        }),
      );
    }

    return holdings;
  }

  function bindStaticActions(appRoot) {
    query(appRoot, '[data-action="dock-add"]').addEventListener("click", () => {
      openHoldingForm();
    });

    query(appRoot, '[data-action="dock-allocation"]').addEventListener("click", () => {
      openAllocationEditor();
    });

    query(appRoot, '[data-action="dock-import"]').addEventListener("click", () => {
      openExcelImport();
    });

    query(appRoot, '[data-action="dock-settings"]').addEventListener("click", openSettings);
    query(appRoot, '[data-action="close-settings"]').addEventListener("click", closeSettings);
    query(appRoot, '[data-action="close-holding"]').addEventListener("click", closeHoldingForm);
    query(appRoot, '[data-action="close-allocation"]').addEventListener("click", closeAllocationEditor);
    query(appRoot, '[data-action="close-excel-import"]').addEventListener("click", closeExcelImport);
    query(appRoot, '[data-action="close-exposure"]').addEventListener("click", closeExposureInsights);
    query(appRoot, '[data-action="close-portfolio-share"]').addEventListener("click", closePortfolioShare);
    query(appRoot, '[data-action="close-portfolio-requests"]').addEventListener("click", closePortfolioRequests);
    query(appRoot, '[data-action="close-portfolio-manage"]').addEventListener("click", closePortfolioManage);
    query(appRoot, '[data-action="close-intelligence"]').addEventListener("click", closePortfolioIntelligence);
  }

  function syncModalVisibility() {
    refs.holdingModal.hidden = !state.ui.holdingOpen;
    refs.allocationModal.hidden = !state.ui.allocationOpen;
    refs.excelImportModal.hidden = !state.ui.excelImportOpen;
    refs.exposureModal.hidden = !state.ui.exposureOpen;
    refs.settingsModal.hidden = !state.ui.settingsOpen;
    refs.portfolioShareModal.hidden = !state.ui.portfolioShareOpen;
    refs.portfolioRequestsModal.hidden = !state.ui.portfolioRequestsOpen;
    refs.portfolioManageModal.hidden = !state.ui.portfolioManageOpen;
    refs.portfolioIntelligenceModal.hidden = !state.ui.portfolioIntelligenceOpen;
  }

  function updateMarketSessions() {
    const snapshot = createMarketSessionSnapshot(state.holdings, state.quotes);

    state.market.sessions = snapshot.sessions;
    state.market.refreshSymbols = snapshot.refreshSymbols;
    state.market.refreshableCount = snapshot.refreshableCount;
    state.market.nextMarketOpenAt = snapshot.nextOpenAt;
    state.market.nextMarketTransitionAt = snapshot.nextTransitionAt;
  }

  function findMarketSession(row) {
    const quoteSymbol = row.quote?.symbol;
    return (
      state.market.sessions[row.symbol] ??
      state.market.sessions[quoteSymbol] ??
      getMarketSession(row.symbol, row.quote)
    );
  }

  function getClosedMissingQuoteSymbols() {
    const attempted = state.market.closedFallbackAttempted ?? new Set();

    return [
      ...new Set(
        state.holdings
          .map((holding) => String(holding.symbol ?? "").trim().toUpperCase())
          .filter(Boolean)
          .filter((symbol) => {
            if (hasUsableCachedQuote(symbol)) {
              return false;
            }

            if (attempted.has(symbol)) {
              return false;
            }

            const session =
              state.market.sessions[symbol] ??
              state.market.sessions[resolveMarketSymbol(symbol)] ??
              getMarketSession(symbol, getCachedQuote(symbol));

            return !session.canRefresh;
          }),
      ),
    ];
  }

  function hasUsableCachedQuote(symbol) {
    const quote = getCachedQuote(symbol);
    const price = Number(quote?.price);
    return Number.isFinite(price) && price > 0;
  }

  function getCachedQuote(symbol) {
    const normalizedSymbol = String(symbol ?? "").trim().toUpperCase();
    const resolvedSymbol = resolveMarketSymbol(normalizedSymbol);
    return state.quotes[normalizedSymbol] ?? state.quotes[resolvedSymbol] ?? null;
  }

  function markClosedFallbackAttempted(symbol, quote = null) {
    const normalizedSymbol = String(symbol ?? "").trim().toUpperCase();
    const resolvedSymbol = resolveMarketSymbol(normalizedSymbol);
    const quoteSymbol = String(quote?.symbol ?? "").trim().toUpperCase();

    [normalizedSymbol, resolvedSymbol, quoteSymbol].filter(Boolean).forEach((key) => {
      state.market.closedFallbackAttempted.add(key);
    });
  }

  async function loadImportCurrencyRates(rows) {
    const currencies = [
      ...new Set(rows.map((row) => normalizeCurrency(row.currency)).filter(Boolean)),
    ];
    const rateEntries = await Promise.all(
      currencies.map(async (currency) => {
        const cachedRate = Number(state.market.currencyRates?.[currency]);

        if (Number.isFinite(cachedRate) && cachedRate > 0) {
          return [currency, { currency, value: cachedRate }];
        }

        const rate = await fetchCurrencyRateToUsd(currency, state.market.fxRate);
        return [rate.currency, rate];
      }),
    );

    state.market.currencyRates = {
      ...state.market.currencyRates,
      ...Object.fromEntries(rateEntries.map(([currency, rate]) => [currency, rate.value])),
    };

    return new Map(rateEntries);
  }
}

function chooseActivePortfolio(portfolios) {
  const storedPortfolioId = getActivePortfolioId();
  const ownedPortfolios = portfolios.filter((portfolio) => portfolio.role === "OWNER");
  const storedOwnedPortfolio = ownedPortfolios.find((portfolio) => portfolio.id === storedPortfolioId);
  const primaryPortfolio =
    ownedPortfolios.find((portfolio) => isMainPortfolio(portfolio)) ??
    ownedPortfolios[0] ??
    null;

  return (
    storedOwnedPortfolio ??
    primaryPortfolio ??
    portfolios[0] ??
    null
  );
}

function isMainPortfolio(portfolio) {
  return portfolio.id === "default-portfolio" || String(portfolio.name || "").trim() === "Main Portfolio";
}

function syncPortfolioList(portfolios, activePortfolio) {
  if (!activePortfolio?.id) {
    return portfolios;
  }

  const nextPortfolios = Array.isArray(portfolios) ? [...portfolios] : [];
  const index = nextPortfolios.findIndex((portfolio) => portfolio.id === activePortfolio.id);

  if (index >= 0) {
    nextPortfolios[index] = {
      ...nextPortfolios[index],
      ...activePortfolio,
    };
    return nextPortfolios;
  }

  return [activePortfolio, ...nextPortfolios];
}

function createLegacyPortfolio(holdings = []) {
  return {
    id: "legacy-default",
    name: "Main Portfolio",
    role: "OWNER",
    permission: "EDIT",
    holdingsCount: Array.isArray(holdings) ? holdings.length : 0,
  };
}

function normalizeCachedQuotes(quotes, holdings = []) {
  if (!quotes || typeof quotes !== "object") {
    return {};
  }

  const allowedSymbols = new Set(
    (Array.isArray(holdings) ? holdings : [])
      .map((holding) => String(holding?.symbol || "").trim().toUpperCase())
      .filter(Boolean)
      .flatMap((symbol) => [symbol, resolveMarketSymbol(symbol)]),
  );
  const normalized = {};

  Object.entries(quotes).forEach(([key, quote]) => {
    if (!quote || typeof quote !== "object") {
      return;
    }

    const cacheKey = String(key || "").trim().toUpperCase();
    const quoteSymbol = String(quote.symbol || cacheKey).trim().toUpperCase();

    if (
      allowedSymbols.size > 0 &&
      !allowedSymbols.has(cacheKey) &&
      !allowedSymbols.has(quoteSymbol)
    ) {
      return;
    }

    const cleanQuote = sanitizeCachedQuote({
      ...quote,
      symbol: quoteSymbol || cacheKey,
    });

    if (!cleanQuote) {
      return;
    }

    if (cacheKey) {
      normalized[cacheKey] = cleanQuote;
    }

    if (cleanQuote.symbol) {
      normalized[cleanQuote.symbol] = cleanQuote;
    }
  });

  return normalized;
}

function createCachedQuotes(quotes, holdings) {
  return normalizeCachedQuotes(quotes, holdings);
}

function sanitizeCachedQuote(quote) {
  const symbol = String(quote.symbol || "").trim().toUpperCase();

  if (!symbol) {
    return null;
  }

  return {
    symbol,
    price: finiteOrNull(quote.price),
    regularPrice: finiteOrNull(quote.regularPrice),
    extendedPrice: finiteOrNull(quote.extendedPrice),
    previousClose: finiteOrNull(quote.previousClose),
    change: finiteOrNull(quote.change),
    changePercent: finiteOrNull(quote.changePercent),
    currency: normalizeCurrency(quote.currency || "USD"),
    exchangeName: String(quote.exchangeName || ""),
    fullExchangeName: String(quote.fullExchangeName || quote.exchangeName || ""),
    instrumentType: String(quote.instrumentType || ""),
    timezone: String(quote.timezone || ""),
    tradingPeriods:
      quote.tradingPeriods && typeof quote.tradingPeriods === "object"
        ? quote.tradingPeriods
        : null,
    source: String(quote.source || "Cached"),
    marketTime: quote.marketTime || null,
    longName: String(quote.longName || symbol),
    quoteType: String(quote.quoteType || ""),
    sector: String(quote.sector || "Other"),
    sectorLabel: String(quote.sectorLabel || ""),
    industry: String(quote.industry || ""),
    country: String(quote.country || ""),
    profileLoaded: Boolean(quote.profileLoaded),
    profileSource: String(quote.profileSource || ""),
  };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function createPortfolioInsightPayload(computed, portfolio) {
  return {
    portfolioName: portfolio?.name || "Portfolio",
    totals: computed.totals,
    holdings: computed.rows.map((row) => ({
      symbol: row.symbol,
      sector: row.quote?.sectorLabel || row.quote?.sector || "Other",
      allocationPercent: row.allocationPercent,
      currentValueUsd: row.currentValueUsd,
      investedUsd: row.investedUsd,
      pnlUsd: row.pnlUsd,
      pnlPercent: row.pnlPercent,
      dailyChangeUsd: row.dailyChangeUsd,
      dailyChangePercent: row.dailyChangePercent,
      session: row.marketSession?.label || "",
      hasQuote: row.hasQuote,
    })),
  };
}

function sortHoldingRows(rows, sortKey) {
  const [field, direction] = normalizeSortKey(sortKey).split("-");
  const sign = direction === "asc" ? 1 : -1;
  const sortedRows = [...rows];

  sortedRows.sort((a, b) => {
    if (field === "symbol") {
      return sign * String(a.symbol || "").localeCompare(String(b.symbol || ""), "en", {
        sensitivity: "base",
      });
    }

    const difference = getSortValue(a, field) - getSortValue(b, field);

    if (Math.abs(difference) > 0.000001) {
      return sign * difference;
    }

    return String(a.symbol || "").localeCompare(String(b.symbol || ""), "en", {
      sensitivity: "base",
    });
  });

  return sortedRows;
}

function getSortValue(row, field) {
  const sortKeys = {
    daily: "dailyChangeUsd",
    pnl: "pnlUsd",
    value: "currentValueUsd",
    invested: "investedUsd",
    shares: "shares",
  };
  const value = Number(row?.[sortKeys[field]]);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function normalizeSortKey(sortKey) {
  const allowedSorts = new Set([
    "symbol-asc",
    "symbol-desc",
    "daily-desc",
    "daily-asc",
    "pnl-desc",
    "pnl-asc",
    "value-desc",
    "value-asc",
    "invested-desc",
    "invested-asc",
    "shares-desc",
    "shares-asc",
  ]);

  return allowedSorts.has(sortKey) ? sortKey : "symbol-asc";
}

function mergeMarketQuotes(existingQuotes, nextQuotes) {
  const mergedQuotes = { ...existingQuotes };

  Object.entries(nextQuotes).forEach(([key, nextQuote]) => {
    const previousQuote = existingQuotes[key] ?? existingQuotes[nextQuote.symbol];
    const merged = {
      ...previousQuote,
      ...nextQuote,
    };

    mergedQuotes[key] = merged;
    mergedQuotes[merged.symbol || key] = merged;
  });

  return mergedQuotes;
}

function sanitizeHoldings(holdings) {
  return holdings
    .map((holding) => ({
      id: holding.id || crypto.randomUUID(),
      symbol: String(holding.symbol ?? "").trim().toUpperCase(),
      investmentUsd: Number(holding.investmentUsd),
      buyPrice: Number(holding.buyPrice),
      buyCurrency: normalizeCurrency(holding.buyCurrency ?? "USD"),
      buyCurrencyToUsd: Number(holding.buyCurrencyToUsd ?? 1),
      shares: Number(holding.shares),
      createdAt: holding.createdAt ?? new Date().toISOString(),
    }))
    .filter(
      (holding) =>
        holding.symbol &&
        Number.isFinite(holding.investmentUsd) &&
        Number.isFinite(holding.buyPrice) &&
        holding.buyCurrency &&
        Number.isFinite(holding.shares),
    );
}

function normalizeCurrency(currency) {
  if (currency === "GBp") {
    return "GBX";
  }

  return String(currency || "USD").trim().toUpperCase();
}

function createSourceLabel(snapshot) {
  const quoteSources = new Set(
    Object.values(snapshot.quotes)
      .map((quote) => quote.source)
      .filter(Boolean),
  );

  if (snapshot.fxSource) {
    quoteSources.add(`FX: ${snapshot.fxSource}`);
  }

  return quoteSources.size ? [...quoteSources].join(" / ") : "--";
}

function shouldAskForForeignCurrency(quote) {
  const currency = normalizeCurrency(quote?.currency ?? "USD");

  return currency !== "USD" && !isUsListedQuote(quote);
}

function isUsListedQuote(quote) {
  const exchangeName = String(quote?.exchangeName ?? "").toUpperCase();
  const symbol = String(quote?.symbol ?? "").toUpperCase();
  const usExchanges = new Set([
    "ASE",
    "BATS",
    "NCM",
    "NGM",
    "NMS",
    "NYQ",
    "PCX",
    "PNK",
    "OTC",
    "US",
  ]);

  return usExchanges.has(exchangeName) || exchangeName.endsWith(".US") || symbol.endsWith(".US");
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

function millisecondsUntil(date) {
  if (!date) {
    return null;
  }

  const value = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diff = value - Date.now();

  return Number.isFinite(diff) && diff > 0 ? diff : null;
}

function formatShortDateTime(date) {
  if (!date) {
    return "--";
  }

  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function roundShares(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100000000) / 100000000;
}

function inferCurrencyFromSymbol(symbol) {
  const suffix = String(symbol || "")
    .toUpperCase()
    .split(".")
    .at(-1);
  const suffixCurrencies = {
    DE: "EUR",
    F: "EUR",
    PA: "EUR",
    AS: "EUR",
    BR: "EUR",
    MI: "EUR",
    MC: "EUR",
    L: "GBX",
    SW: "CHF",
    TO: "CAD",
    V: "CAD",
  };

  return suffixCurrencies[suffix] ?? "USD";
}
