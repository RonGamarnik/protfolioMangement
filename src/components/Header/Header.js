import { loadTemplate } from "../../lib/template.js";
import { query, setTextIfChanged } from "../../lib/dom.js";

export async function renderHeader(container, state, actions) {
  if (container.dataset.ready !== "1") {
    const template = await loadTemplate(new URL("./Header.html", import.meta.url));
    container.innerHTML = template;
    bindActions(container, actions);
    container.dataset.ready = "1";
  }

  const header = query(container, ".app-header");
  const ubsButton = query(container, '[data-action="toggle-ubs-mode"]');
  const portfolioSelect = query(container, '[data-field="portfolio-select"]');
  const managePortfolioButton = query(container, '[data-action="manage-portfolio"]');
  const createPortfolioButton = query(container, '[data-action="create-portfolio"]');
  const sharePortfolioButton = query(container, '[data-action="share-portfolio"]');
  const portfolioRequestsButton = query(container, '[data-action="portfolio-requests"]');
  const portfolioRequestsCount = query(container, '[data-field="portfolio-requests-count"]');
  const settingsButton = query(container, '[data-action="settings"]');
  const clearButton = query(container, '[data-action="clear"]');
  const aiButton = query(container, '[data-action="portfolio-ai"]');
  const activePortfolio = getActivePortfolio(state);
  const canEditPortfolio = !activePortfolio || activePortfolio.permission === "EDIT";
  const canSharePortfolio = activePortfolio?.role === "OWNER";
  const managementAvailable = state.portfolios?.managementAvailable !== false;
  const isPortfolioLoading = Boolean(state.portfolios?.isLoading);

  header.classList.toggle("is-loading", state.market.isLoading);
  ubsButton.classList.toggle("is-active", Boolean(state.settings.ubsMode));
  ubsButton.setAttribute("aria-pressed", String(Boolean(state.settings.ubsMode)));
  ubsButton.title = state.settings.ubsMode ? "UBS Mode active" : "UBS Mode";
  ubsButton.disabled = !canEditPortfolio;
  settingsButton.disabled = !canEditPortfolio;
  clearButton.disabled = !canEditPortfolio;
  aiButton.disabled = !state.holdings.length;
  aiButton.title = state.holdings.length ? "Portfolio Intelligence" : "Add holdings to run intelligence";
  managePortfolioButton.disabled = isPortfolioLoading;
  managePortfolioButton.title = managementAvailable
    ? "Manage portfolio"
    : "Restart the Python server to enable portfolio management";
  createPortfolioButton.disabled = isPortfolioLoading;
  createPortfolioButton.title = managementAvailable
    ? "New portfolio"
    : "Restart the Python server to enable multiple portfolios";
  sharePortfolioButton.disabled = isPortfolioLoading;
  sharePortfolioButton.title = !managementAvailable
    ? "Restart the Python server to enable sharing"
    : canSharePortfolio
      ? "Share portfolio"
      : "Only owners can share";
  portfolioRequestsButton.disabled = isPortfolioLoading;
  renderRequestBadge(portfolioRequestsCount, state.portfolios?.shareRequests?.length ?? 0);
  renderPortfolioOptions(
    portfolioSelect,
    state.portfolios?.items ?? [],
    state.portfolios?.activeId,
    managementAvailable,
  );
  setTextIfChanged(
    container,
    "[data-user-name]",
    state.user?.displayName || state.user?.email || "חשבון",
  );
}

function bindActions(container, actions) {
  query(container, '[data-field="portfolio-select"]').addEventListener("change", (event) => {
    actions.switchPortfolio(event.target.value);
  });

  query(container, '[data-action="create-portfolio"]').addEventListener("click", () => {
    actions.createNewPortfolio();
  });

  query(container, '[data-action="manage-portfolio"]').addEventListener("click", () => {
    actions.openPortfolioManage();
  });

  query(container, '[data-action="share-portfolio"]').addEventListener("click", () => {
    actions.openPortfolioShare();
  });

  query(container, '[data-action="portfolio-requests"]').addEventListener("click", () => {
    actions.openPortfolioRequests();
  });

  query(container, '[data-action="refresh"]').addEventListener("click", () => {
    actions.refreshMarket();
  });

  query(container, '[data-action="settings"]').addEventListener("click", () => {
    actions.openSettings();
  });

  query(container, '[data-action="toggle-ubs-mode"]').addEventListener("click", () => {
    actions.toggleUbsMode();
  });

  query(container, '[data-action="portfolio-ai"]').addEventListener("click", () => {
    actions.openPortfolioIntelligence();
  });

  query(container, '[data-action="clear"]').addEventListener("click", () => {
    actions.clearPortfolio();
  });

  query(container, '[data-action="logout"]').addEventListener("click", () => {
    actions.logout();
  });

}

function renderPortfolioOptions(select, portfolios, activeId, managementAvailable) {
  const signature = portfolios
    .map((portfolio) => `${portfolio.id}:${portfolio.name}:${portfolio.role}:${portfolio.permission}`)
    .join("|");

  if (select.dataset.signature !== signature) {
    select.replaceChildren(
      ...portfolios.map((portfolio) => {
        const option = document.createElement("option");
        option.value = portfolio.id;
        option.textContent = createPortfolioLabel(portfolio);
        return option;
      }),
    );
    select.dataset.signature = signature;
  }

  select.value = activeId || portfolios[0]?.id || "";
  select.disabled = false;
  select.title = !managementAvailable
    ? "Restart the Python server to enable multiple portfolios"
    : portfolios.length <= 1
      ? "Only one portfolio"
      : "Switch portfolio";
}

function createPortfolioLabel(portfolio) {
  const suffix = portfolio.role === "SHARED" ? ` (${portfolio.permission.toLowerCase()} shared)` : "";
  return `${portfolio.name}${suffix}`;
}

function renderRequestBadge(badge, count) {
  badge.hidden = count <= 0;
  badge.textContent = String(count);
}

function getActivePortfolio(state) {
  return (
    state.portfolios?.items?.find((portfolio) => portfolio.id === state.portfolios.activeId) ??
    null
  );
}
