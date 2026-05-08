import { getAuthHeader } from "./authService.js";

export async function requestPortfolioInsights(snapshot) {
  const response = await fetch("/api/ai/portfolio-insights", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(snapshot),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "AI request failed");
  }

  return payload;
}
