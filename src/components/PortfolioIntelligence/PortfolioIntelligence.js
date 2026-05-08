import { loadTemplate, escapeHtml } from "../../lib/template.js";
import { query } from "../../lib/dom.js";
import { formatCurrency, formatPercent, signed } from "../../lib/formatters.js";

export async function createPortfolioIntelligence(container, actions) {
  const template = await loadTemplate(new URL("./PortfolioIntelligence.html", import.meta.url));
  container.innerHTML = template;

  query(container, '[data-action="close-intelligence"]').addEventListener("click", () => {
    actions.closePortfolioIntelligence?.();
  });

  query(container, '[data-action="run-ai"]').addEventListener("click", () => {
    actions.generatePortfolioAiInsights?.();
  });

  function render({ computed, portfolio, ai, isLoading, error }) {
    const rows = [...computed.rows].sort((a, b) => (b.allocationPercent || 0) - (a.allocationPercent || 0));
    renderAi(ai, isLoading, error);
    renderRiskRadar(rows, computed.totals, portfolio);
    renderShockLab(computed.totals);
    renderRebalanceIdeas(rows);

    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }
  }

  return {
    render,
  };

  function renderAi(ai, isLoading, error) {
    const button = query(container, '[data-action="run-ai"]');
    const label = query(container, '[data-field="ai-button-label"]');
    const source = query(container, '[data-field="ai-source"]');
    const text = query(container, '[data-field="ai-text"]');

    button.disabled = Boolean(isLoading);
    label.textContent = isLoading ? "Running..." : "Run AI";

    if (isLoading) {
      source.textContent = "Building a server-side brief";
      text.textContent = "מנתח את התיק...";
      return;
    }

    if (error) {
      source.textContent = "AI request failed";
      text.textContent = error;
      return;
    }

    if (!ai?.text) {
      source.textContent = "Local analysis ready";
      text.textContent = "לחץ Run AI כדי לקבל דעה על התיק, רעיונות לשיפור וצפי היפותטי להמשך.";
      return;
    }

    source.textContent = createAiSourceLabel(ai);
    text.textContent = ai.text;
  }
}

function renderRiskRadar(rows, totals, portfolio) {
  const topHolding = rows[0];
  const topThree = rows.slice(0, 3).reduce((sum, row) => sum + (row.allocationPercent || 0), 0);
  const losers = rows.filter((row) => Number(row.pnlUsd) < 0).length;
  const quoteCoverage = Number(totals.quoteCoveragePercent);
  const status = createRiskStatus(topHolding, topThree, quoteCoverage);

  setHtml(
    "risk-radar",
    [
      metricItem("Largest holding", topHolding ? `${topHolding.symbol} ${formatPercent(topHolding.allocationPercent)}` : "--", status.top),
      metricItem("Top 3 concentration", formatPercent(topThree), status.concentration),
      metricItem("Positions below cost", String(losers), losers > rows.length / 2 ? "is-warning" : "is-ok"),
      metricItem("Quote coverage", formatPercent(quoteCoverage), quoteCoverage < 80 ? "is-warning" : "is-ok"),
      metricItem("Mode", totals.ubsMode ? "UBS Mode active" : portfolio?.permission === "VIEW" ? "View-only" : "Live portfolio", "is-info"),
    ].join(""),
  );
}

function renderShockLab(totals) {
  const value = Number(totals.currentValueUsd);
  const daily = Number(totals.dailyChangeUsd);
  const ubsReserve = Number(totals.ubsPrincipalUsd);
  const marketDown = Number.isFinite(value) ? value * -0.05 : null;
  const topRisk = Number.isFinite(value) ? value * -0.10 : null;
  const fxMove = Number.isFinite(value) ? value * 0.02 : null;

  setHtml(
    "shock-lab",
    [
      metricItem("Market -5%", signed(marketDown, (item) => formatCurrency(item, "USD")), "is-warning"),
      metricItem("Largest risk proxy -10%", signed(topRisk, (item) => formatCurrency(item, "USD")), "is-warning"),
      metricItem("USD/ILS +2%", signed(fxMove, (item) => formatCurrency(item, "USD")), "is-info"),
      metricItem("Today vs shock", Number.isFinite(daily) ? `${formatCurrency(daily, "USD")} today` : "--", "is-info"),
      metricItem("UBS protected gap", Number.isFinite(ubsReserve) ? formatCurrency(ubsReserve, "USD") : "--", ubsReserve > 0 ? "is-info" : "is-ok"),
    ].join(""),
  );
}

function renderRebalanceIdeas(rows) {
  const ideas = [];
  const overweight = rows.filter((row) => Number(row.allocationPercent) >= 20).slice(0, 4);
  const underCost = rows.filter((row) => Number(row.pnlUsd) < 0).slice(0, 4);
  const noQuote = rows.filter((row) => !row.hasQuote).slice(0, 4);

  overweight.forEach((row) => {
    ideas.push({
      label: row.symbol,
      title: "Concentration check",
      text: `${formatPercent(row.allocationPercent)} of the portfolio. Review whether this size is intentional.`,
      tone: "is-warning",
    });
  });

  underCost.forEach((row) => {
    ideas.push({
      label: row.symbol,
      title: "Below cost basis",
      text: `${signed(row.pnlUsd, (value) => formatCurrency(value, "USD"))}. Decide if this is a conviction add, hold, or exit review.`,
      tone: "is-info",
    });
  });

  noQuote.forEach((row) => {
    ideas.push({
      label: row.symbol,
      title: "Missing live quote",
      text: "No reliable market quote is loaded. Check the ticker mapping before relying on totals.",
      tone: "is-warning",
    });
  });

  if (!ideas.length) {
    ideas.push({
      label: "OK",
      title: "No immediate flags",
      text: "The portfolio does not show obvious concentration, quote, or cost-basis alerts.",
      tone: "is-ok",
    });
  }

  setHtml(
    "rebalance-ideas",
    ideas
      .slice(0, 8)
      .map(
        (idea) => `
          <article class="rebalance-item ${idea.tone}">
            <span>${escapeHtml(idea.label)}</span>
            <div>
              <strong>${escapeHtml(idea.title)}</strong>
              <p>${escapeHtml(idea.text)}</p>
            </div>
          </article>
        `,
      )
      .join(""),
  );
}

function metricItem(label, value, tone = "is-info") {
  return `
    <article class="metric-item ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function createRiskStatus(topHolding, topThree, quoteCoverage) {
  return {
    top: Number(topHolding?.allocationPercent) >= 30 ? "is-warning" : "is-ok",
    concentration: topThree >= 60 ? "is-warning" : "is-ok",
    coverage: quoteCoverage < 80 ? "is-warning" : "is-ok",
  };
}

function createAiSourceLabel(ai) {
  if (ai.source === "openai") {
    return `OpenAI ${ai.model || ""}`.trim();
  }

  if (ai.source === "local-fallback") {
    return "Local fallback after AI error";
  }

  return "Local analysis";
}

function setHtml(field, html) {
  const element = document.querySelector(`[data-component="PortfolioIntelligence"] [data-field="${field}"]`);

  if (element) {
    element.innerHTML = html;
  }
}
