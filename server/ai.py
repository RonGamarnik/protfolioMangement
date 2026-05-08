from __future__ import annotations

import json
import urllib.error
import urllib.request

from .config import AppConfig


OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
AI_DISCLOSURE = (
    "זו אינה המלצה, אינה הוראת פעולה ואינה ייעוץ השקעות, ייעוץ פיננסי או ייעוץ עסקי. "
    "הניתוח הוא דעה לימודית על תיק היפותטי לפי הנתונים שסופקו בלבד."
)


def create_portfolio_insights(config: AppConfig, payload):
    snapshot = normalize_snapshot(payload)

    if not config.openai_api_key:
        return {
            "source": "local",
            "text": build_local_insight_text(snapshot),
            "model": None,
        }

    try:
        return {
            "source": "openai",
            "text": request_openai_insights(config, snapshot),
            "model": config.openai_model,
        }
    except Exception as error:
        print(f"OpenAI portfolio insights failed: {error}")
        return {
            "source": "local-fallback",
            "text": build_local_insight_text(snapshot),
            "model": config.openai_model,
            "warning": "AI service was unavailable, so a local summary was generated.",
        }


def request_openai_insights(config: AppConfig, snapshot) -> str:
    body = {
        "model": config.openai_model,
        "instructions": (
            "You are a careful portfolio analysis assistant. Write in Hebrew. "
            f"Always start with this disclosure exactly: {AI_DISCLOSURE} "
            "Then analyze the portfolio as a hypothetical educational case. "
            "Give a clear opinion on the portfolio quality, concentration, risk, diversification, "
            "sector exposure, currency exposure, winners/losers, and daily movement. "
            "Provide practical improvement ideas you would consider in a hypothetical portfolio, "
            "but phrase them as review points, not direct orders to buy, sell, or hold. "
            "Include a forward-looking outlook section with scenarios for what could happen next, "
            "including upside drivers, downside risks, and what signals should be watched. "
            "Do not claim certainty, do not promise returns, and do not present predictions as facts. "
            "Use this structure: 1) שורה תחתונה, 2) מה טוב בתיק, 3) נקודות חולשה, "
            "4) שיפורים שהייתי שוקל בתיק היפותטי, 5) צפי להמשך וטריגרים למעקב."
        ),
        "input": (
            "Analyze this portfolio snapshot and provide an opinion, hypothetical improvements, "
            "and a cautious forward-looking outlook:\n"
            f"{json.dumps(snapshot, ensure_ascii=False)}"
        ),
        "max_output_tokens": 900,
    }
    request = urllib.request.Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config.openai_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI HTTP {error.code}: {details[:300]}") from error

    text = extract_response_text(result)

    if not text:
        raise RuntimeError("OpenAI response did not include text")

    return text.strip()


def normalize_snapshot(payload):
    totals = payload.get("totals") if isinstance(payload.get("totals"), dict) else {}
    rows = payload.get("holdings") if isinstance(payload.get("holdings"), list) else []

    return {
        "portfolioName": clean_text(payload.get("portfolioName"), 120),
        "totals": {
            "holdingsCount": number_or_none(totals.get("holdingsCount")),
            "currentValueUsd": number_or_none(totals.get("currentValueUsd")),
            "totalInvestedUsd": number_or_none(totals.get("totalInvestedUsd")),
            "pnlUsd": number_or_none(totals.get("pnlUsd")),
            "pnlPercent": number_or_none(totals.get("pnlPercent")),
            "dailyChangeUsd": number_or_none(totals.get("dailyChangeUsd")),
            "dailyChangePercent": number_or_none(totals.get("dailyChangePercent")),
            "quoteCoveragePercent": number_or_none(totals.get("quoteCoveragePercent")),
            "ubsMode": bool(totals.get("ubsMode")),
            "ubsPrincipalUsd": number_or_none(totals.get("ubsPrincipalUsd")),
        },
        "holdings": [normalize_holding(row) for row in rows[:60] if isinstance(row, dict)],
    }


def normalize_holding(row):
    return {
        "symbol": clean_text(row.get("symbol"), 40),
        "sector": clean_text(row.get("sector"), 80),
        "allocationPercent": number_or_none(row.get("allocationPercent")),
        "currentValueUsd": number_or_none(row.get("currentValueUsd")),
        "investedUsd": number_or_none(row.get("investedUsd")),
        "pnlUsd": number_or_none(row.get("pnlUsd")),
        "pnlPercent": number_or_none(row.get("pnlPercent")),
        "dailyChangeUsd": number_or_none(row.get("dailyChangeUsd")),
        "dailyChangePercent": number_or_none(row.get("dailyChangePercent")),
        "session": clean_text(row.get("session"), 40),
    }


def build_local_insight_text(snapshot) -> str:
    holdings = snapshot["holdings"]
    totals = snapshot["totals"]
    sorted_by_allocation = sorted(
        holdings,
        key=lambda row: row.get("allocationPercent") or 0,
        reverse=True,
    )
    top = sorted_by_allocation[0] if sorted_by_allocation else None
    top_three = sum((row.get("allocationPercent") or 0) for row in sorted_by_allocation[:3])
    losers = [row for row in holdings if (row.get("pnlUsd") or 0) < 0]
    daily_leaders = sorted(
        holdings,
        key=lambda row: row.get("dailyChangeUsd") or 0,
        reverse=True,
    )[:3]

    lines = [
        AI_DISCLOSURE,
        "",
        "שורה תחתונה:",
        f"- שווי נוכחי: {totals.get('currentValueUsd') or 0:,.2f} USD.",
        f"- ריכוזיות Top 3: {top_three:.1f}% מהתיק.",
    ]

    if top:
        lines.append(
            f"- ההחזקה הגדולה היא {top.get('symbol') or '--'} עם {top.get('allocationPercent') or 0:.1f}%."
        )

    if losers:
        lines.append(f"- {len(losers)} החזקות נמצאות מתחת למחיר הקנייה כרגע.")

    if daily_leaders:
        leaders = ", ".join(row.get("symbol") or "--" for row in daily_leaders)
        lines.append(f"- מובילות יומית לבדיקה: {leaders}.")

    lines.extend(
        [
            "",
            "שיפורים שהייתי שוקל בתיק היפותטי:",
            "- לבדוק אם הריכוזיות במניות הגדולות מכוונת או גבוהה מדי ביחס לסיכון הרצוי.",
            "- לבדוק פיזור סקטוריאלי ומטבעי, במיוחד אם רוב התיק תלוי באותו נושא השקעה.",
            "- לבנות כללי מעקב ברורים: מתי מחזקים, מתי מצמצמים, ומה מבטל את התזה.",
            "",
            "צפי להמשך:",
            "- אם המומנטום היומי ימשיך יחד עם שיפור רוחבי בכמה החזקות, התיק עשוי ליהנות מהמשך חיובי.",
            "- אם הירידות יתרכזו באותן החזקות גדולות, הריכוזיות עלולה להגדיל תנודתיות.",
            "- כדאי לעקוב אחרי שינויי סקטור, מטבע, הודעות חברות ומצב השוק הרחב.",
        ]
    )
    return "\n".join(lines)


def extract_response_text(result) -> str:
    if isinstance(result.get("output_text"), str):
        return result["output_text"]

    chunks = []
    for item in result.get("output") or []:
        for content in item.get("content") or []:
            text = content.get("text")
            if isinstance(text, str):
                chunks.append(text)

    return "\n".join(chunks)


def clean_text(value, max_length: int) -> str:
    return str(value or "").strip()[:max_length]


def number_or_none(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    return number if number == number else None
