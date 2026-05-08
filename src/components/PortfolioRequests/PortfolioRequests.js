import { loadTemplate } from "../../lib/template.js";
import { escapeHtml } from "../../lib/template.js";
import { query } from "../../lib/dom.js";

export async function createPortfolioRequests(container, actions) {
  const template = await loadTemplate(new URL("./PortfolioRequests.html", import.meta.url));
  container.innerHTML = template;

  const requestsContainer = query(container, '[data-field="requests"]');

  container.addEventListener("click", (event) => {
    const closeButton = event.target.closest('[data-action="close-portfolio-requests"]');
    const acceptButton = event.target.closest("[data-accept-share-id]");
    const declineButton = event.target.closest("[data-decline-share-id]");

    if (closeButton) {
      actions.closePortfolioRequests();
      return;
    }

    if (acceptButton) {
      actions.acceptPortfolioRequest(acceptButton.dataset.acceptShareId);
      return;
    }

    if (declineButton) {
      actions.declinePortfolioRequest(declineButton.dataset.declineShareId);
    }
  });

  function render({ requests }) {
    requestsContainer.innerHTML = renderRequests(requests ?? []);
  }

  return {
    render,
  };
}

function renderRequests(requests) {
  if (!requests.length) {
    return '<div class="portfolio-requests__empty">No pending requests</div>';
  }

  return requests.map(renderRequest).join("");
}

function renderRequest(request) {
  const owner = request.ownerName || request.ownerEmail || "User";
  const permission = request.permission === "EDIT" ? "Can edit" : "View only";

  return `
    <div class="portfolio-requests__item">
      <div class="portfolio-requests__identity">
        <strong>${escapeHtml(request.portfolioName || "Shared portfolio")}</strong>
        <span>Shared by ${escapeHtml(owner)}</span>
      </div>
      <span class="portfolio-requests__permission">${permission}</span>
      <div class="portfolio-requests__actions">
        <button class="button button--secondary" type="button" data-accept-share-id="${escapeHtml(request.id)}">Accept</button>
        <button class="ghost-button" type="button" data-decline-share-id="${escapeHtml(request.id)}">Decline</button>
      </div>
    </div>
  `;
}
