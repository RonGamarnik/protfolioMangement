import { loadTemplate } from "../../lib/template.js";
import { escapeHtml } from "../../lib/template.js";
import { query } from "../../lib/dom.js";

export async function createPortfolioShare(container, actions) {
  const template = await loadTemplate(new URL("./PortfolioShare.html", import.meta.url));
  container.innerHTML = template;

  const form = query(container, '[data-field="form"]');
  const emailInput = query(container, '[data-field="email"]');
  const permissionInput = query(container, '[data-field="permission"]');
  const sharesContainer = query(container, '[data-field="shares"]');
  const portfolioName = query(container, '[data-field="portfolio-name"]');

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    actions.shareActivePortfolio({
      email: emailInput.value,
      permission: permissionInput.value,
    });
  });

  container.addEventListener("click", (event) => {
    const closeButton = event.target.closest('[data-action="close-portfolio-share"]');
    const revokeButton = event.target.closest("[data-share-id]");

    if (closeButton) {
      actions.closePortfolioShare();
      return;
    }

    if (revokeButton) {
      actions.revokeActivePortfolioShare(revokeButton.dataset.shareId);
    }
  });

  function render({ portfolio, shares, canManage }) {
    portfolioName.textContent = portfolio?.name
      ? `${portfolio.name} access`
      : "Select who can view or edit this portfolio";
    form.hidden = !canManage;
    sharesContainer.innerHTML = renderShares(shares ?? [], canManage);
  }

  function reset() {
    form.reset();
    permissionInput.value = "VIEW";
  }

  return {
    render,
    reset,
  };
}

function renderShares(shares, canManage) {
  if (!shares.length) {
    return '<div class="portfolio-share__empty">No shared users yet</div>';
  }

  return shares.map((share) => renderShare(share, canManage)).join("");
}

function renderShare(share, canManage) {
  const displayName = share.displayName || share.email || "User";
  const permission = share.permission === "EDIT" ? "Can edit" : "View only";
  const status = share.status === "PENDING" ? "Pending" : permission;

  return `
    <div class="portfolio-share__item">
      <div class="portfolio-share__identity">
        <strong>${escapeHtml(displayName)}</strong>
        <span>${escapeHtml(share.email || "")}</span>
      </div>
      <span class="portfolio-share__badge">${status}</span>
      ${
        canManage
          ? `<button class="icon-button icon-button--danger" type="button" data-share-id="${escapeHtml(share.id)}" aria-label="Remove share">
              <i data-lucide="trash-2"></i>
            </button>`
          : ""
      }
    </div>
  `;
}
