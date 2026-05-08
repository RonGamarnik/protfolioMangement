import { loadTemplate } from "../../lib/template.js";
import { query } from "../../lib/dom.js";

export async function createPortfolioManage(container, actions) {
  const template = await loadTemplate(new URL("./PortfolioManage.html", import.meta.url));
  container.innerHTML = template;

  const subtitle = query(container, '[data-field="portfolio-subtitle"]');
  const role = query(container, '[data-field="portfolio-role"]');
  const name = query(container, '[data-field="portfolio-name"]');
  const meta = query(container, '[data-field="portfolio-meta"]');
  const deleteLabel = query(container, '[data-field="delete-label"]');
  const deleteButton = query(container, '[data-action="delete-active-portfolio"]');

  container.addEventListener("click", (event) => {
    const closeButton = event.target.closest('[data-action="close-portfolio-manage"]');
    const deleteActiveButton = event.target.closest('[data-action="delete-active-portfolio"]');

    if (closeButton) {
      actions.closePortfolioManage();
      return;
    }

    if (deleteActiveButton) {
      actions.deleteActivePortfolio();
    }
  });

  function render({ portfolio, canDelete }) {
    const isShared = portfolio?.role === "SHARED";
    subtitle.textContent = isShared
      ? "Remove a shared portfolio from your account"
      : "Manage the active portfolio";
    role.textContent = isShared ? `${portfolio.permission || "VIEW"} shared` : "Owner";
    name.textContent = portfolio?.name || "Portfolio";
    meta.textContent = `${portfolio?.holdingsCount ?? 0} holdings`;
    deleteLabel.textContent = isShared ? "Remove from my account" : "Delete portfolio";
    deleteButton.disabled = !canDelete;
    deleteButton.title = canDelete ? "" : "You cannot delete your only owned portfolio";
  }

  return {
    render,
  };
}
