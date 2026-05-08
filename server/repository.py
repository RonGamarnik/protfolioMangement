from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path

from .config import AppConfig
from .database import DEFAULT_PORTFOLIO_ID, TABLE_NAMES, connect


class PortfolioAccessError(ValueError):
    def __init__(self, message: str, status_code: int = 403):
        super().__init__(message)
        self.status_code = status_code


class PortfolioRepository:
    def __init__(self, config: AppConfig):
        self.config = config

    def list_portfolios(self, user_id: str):
        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                self._ensure_user_portfolio(cursor, user_id)
                cursor.execute(
                    """
                    SELECT
                      p.id,
                      p.name,
                      p.user_id AS owner_user_id,
                      u.display_name AS owner_name,
                      u.email AS owner_email,
                      p.base_currency,
                      p.reporting_currency,
                      p.created_at,
                      p.updated_at,
                      'OWNER' AS role,
                      'EDIT' AS permission,
                      (
                        SELECT COUNT(*)
                        FROM portfolio_positions pp
                        WHERE pp.portfolio_id = p.id
                      ) AS holdings_count
                    FROM portfolios p
                    JOIN users u ON u.id = p.user_id
                    WHERE p.user_id = %s
                    UNION ALL
                    SELECT
                      p.id,
                      p.name,
                      p.user_id AS owner_user_id,
                      u.display_name AS owner_name,
                      u.email AS owner_email,
                      p.base_currency,
                      p.reporting_currency,
                      p.created_at,
                      p.updated_at,
                      'SHARED' AS role,
                      s.permission,
                      (
                        SELECT COUNT(*)
                        FROM portfolio_positions pp
                        WHERE pp.portfolio_id = p.id
                      ) AS holdings_count
                    FROM portfolio_shares s
                    JOIN portfolios p ON p.id = s.portfolio_id
                    JOIN users u ON u.id = p.user_id
                    WHERE s.shared_with_user_id = %s
                      AND s.status = 'ACCEPTED'
                    ORDER BY updated_at DESC
                    """,
                    (user_id, user_id),
                )
                portfolios = [self._map_portfolio(row) for row in cursor.fetchall()]
            connection.commit()

        return {"portfolios": portfolios}

    def read_portfolio(self, user_id: str, portfolio_id: str | None = None):
        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                resolved_id, portfolio = self._resolve_portfolio_access(cursor, user_id, portfolio_id)
                state = self._read_portfolio_state(cursor, resolved_id)
            connection.commit()

        return {
            **state,
            "portfolio": portfolio,
        }

    def write_portfolio(self, user_id: str, payload, portfolio_id: str | None = None) -> None:
        validate_portfolio_payload(payload)

        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    resolved_id, _portfolio = self._resolve_portfolio_access(
                        cursor,
                        user_id,
                        portfolio_id,
                        require_write=True,
                    )
                    self._replace_portfolio_state(cursor, resolved_id, payload)

                connection.commit()
            except Exception:
                connection.rollback()
                raise

    def create_portfolio(self, user_id: str, payload):
        name = clean_portfolio_name(payload.get("name"))
        portfolio_id = f"portfolio-{uuid.uuid4().hex}"

        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO portfolios (id, user_id, name, base_currency, reporting_currency)
                        VALUES (%s, %s, %s, %s, %s)
                        """,
                        (portfolio_id, user_id, name, "USD", "ILS"),
                    )
                    _resolved_id, portfolio = self._resolve_portfolio_access(
                        cursor,
                        user_id,
                        portfolio_id,
                    )
                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return {"portfolio": portfolio}

    def rename_portfolio(self, user_id: str, portfolio_id: str, payload):
        name = clean_portfolio_name(payload.get("name"))

        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    self._require_portfolio_owner(cursor, user_id, portfolio_id)
                    cursor.execute(
                        """
                        UPDATE portfolios
                        SET name = %s,
                            updated_at = CURRENT_TIMESTAMP(3)
                        WHERE id = %s
                        """,
                        (name, portfolio_id),
                    )
                    _resolved_id, portfolio = self._resolve_portfolio_access(
                        cursor,
                        user_id,
                        portfolio_id,
                    )
                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return {"portfolio": portfolio}

    def delete_portfolio(self, user_id: str, portfolio_id: str) -> None:
        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT user_id FROM portfolios WHERE id = %s",
                        (portfolio_id,),
                    )
                    portfolio = cursor.fetchone()

                    if not portfolio:
                        raise PortfolioAccessError("Portfolio not found", status_code=404)

                    if portfolio["user_id"] != user_id:
                        cursor.execute(
                            """
                            DELETE FROM portfolio_shares
                            WHERE portfolio_id = %s
                              AND shared_with_user_id = %s
                            """,
                            (portfolio_id, user_id),
                        )

                        if cursor.rowcount == 0:
                            raise PortfolioAccessError("Portfolio not found", status_code=404)

                        connection.commit()
                        return

                    cursor.execute(
                        "SELECT COUNT(*) AS count FROM portfolios WHERE user_id = %s",
                        (user_id,),
                    )
                    if int(cursor.fetchone()["count"]) <= 1:
                        raise PortfolioAccessError("Cannot delete your only portfolio", status_code=400)
                    cursor.execute("DELETE FROM portfolios WHERE id = %s", (portfolio_id,))
                connection.commit()
            except Exception:
                connection.rollback()
                raise

    def list_portfolio_shares(self, user_id: str, portfolio_id: str):
        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                self._require_portfolio_owner(cursor, user_id, portfolio_id)
                shares = self._read_portfolio_shares(cursor, portfolio_id)

        return {"shares": shares}

    def list_share_requests(self, user_id: str):
        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                      s.id,
                      s.permission,
                      s.status,
                      s.created_at,
                      s.updated_at,
                      p.id AS portfolio_id,
                      p.name AS portfolio_name,
                      p.user_id AS owner_user_id,
                      u.display_name AS owner_name,
                      u.email AS owner_email
                    FROM portfolio_shares s
                    JOIN portfolios p ON p.id = s.portfolio_id
                    JOIN users u ON u.id = p.user_id
                    WHERE s.shared_with_user_id = %s
                      AND s.status = 'PENDING'
                    ORDER BY s.created_at DESC
                    """,
                    (user_id,),
                )
                requests = [self._map_share_request(row) for row in cursor.fetchall()]

        return {"requests": requests}

    def share_portfolio(self, user_id: str, portfolio_id: str, payload):
        email = str(payload.get("email") or "").strip().lower()
        permission = normalize_share_permission(payload.get("permission"))

        if not email:
            raise ValueError("Email is required")

        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    self._require_portfolio_owner(cursor, user_id, portfolio_id)
                    cursor.execute(
                        """
                        SELECT id, email, display_name
                        FROM users
                        WHERE email = %s
                        """,
                        (email,),
                    )
                    target_user = cursor.fetchone()

                    if not target_user:
                        raise PortfolioAccessError("User not found", status_code=404)

                    if target_user["id"] == user_id:
                        raise PortfolioAccessError("Cannot share a portfolio with yourself", status_code=400)

                    cursor.execute(
                        """
                        INSERT INTO portfolio_shares (
                          id,
                          portfolio_id,
                          shared_with_user_id,
                          permission,
                          status,
                          accepted_at
                        ) VALUES (%s, %s, %s, %s, 'PENDING', NULL)
                        ON DUPLICATE KEY UPDATE
                          permission = VALUES(permission),
                          updated_at = CURRENT_TIMESTAMP(3)
                        """,
                        (
                            f"share-{uuid.uuid4().hex}",
                            portfolio_id,
                            target_user["id"],
                            permission,
                        ),
                    )
                    shares = self._read_portfolio_shares(cursor, portfolio_id)
                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return {"shares": shares}

    def accept_portfolio_share(self, user_id: str, share_id: str):
        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE portfolio_shares
                        SET status = 'ACCEPTED',
                            accepted_at = CURRENT_TIMESTAMP(3),
                            updated_at = CURRENT_TIMESTAMP(3)
                        WHERE id = %s
                          AND shared_with_user_id = %s
                          AND status = 'PENDING'
                        """,
                        (share_id, user_id),
                    )

                    if cursor.rowcount == 0:
                        raise PortfolioAccessError("Share request not found", status_code=404)

                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return {"ok": True}

    def decline_portfolio_share(self, user_id: str, share_id: str) -> None:
        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        DELETE FROM portfolio_shares
                        WHERE id = %s
                          AND shared_with_user_id = %s
                          AND status = 'PENDING'
                        """,
                        (share_id, user_id),
                    )

                    if cursor.rowcount == 0:
                        raise PortfolioAccessError("Share request not found", status_code=404)

                connection.commit()
            except Exception:
                connection.rollback()
                raise

    def revoke_portfolio_share(self, user_id: str, portfolio_id: str, share_id: str) -> None:
        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    self._require_portfolio_owner(cursor, user_id, portfolio_id)
                    cursor.execute(
                        "DELETE FROM portfolio_shares WHERE id = %s AND portfolio_id = %s",
                        (share_id, portfolio_id),
                    )
                connection.commit()
            except Exception:
                connection.rollback()
                raise

    def migrate_legacy_mysql_if_needed(self) -> None:
        if self._has_positions(DEFAULT_PORTFOLIO_ID):
            return

        legacy_state = self._read_legacy_mysql_state()

        if legacy_state and legacy_state.get("holdings"):
            with connect(self.config) as connection:
                try:
                    with connection.cursor() as cursor:
                        self._replace_portfolio_state(cursor, DEFAULT_PORTFOLIO_ID, legacy_state)
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
            print("Migrated legacy MySQL tables into the normalized information system schema")

    def migrate_sqlite_if_needed(self) -> None:
        if (
            not self.config.migrate_sqlite
            or not self.config.sqlite_migration_path.exists()
            or self._has_positions(DEFAULT_PORTFOLIO_ID)
        ):
            return

        legacy_state = read_sqlite_portfolio(self.config.sqlite_migration_path)

        if legacy_state and legacy_state.get("holdings"):
            with connect(self.config) as connection:
                try:
                    with connection.cursor() as cursor:
                        self._replace_portfolio_state(cursor, DEFAULT_PORTFOLIO_ID, legacy_state)
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
            print(f"Migrated legacy SQLite data from {self.config.sqlite_migration_path}")

    def system_snapshot(self, user_id: str | None = None):
        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                table_counts = {}

                for table_name in TABLE_NAMES:
                    cursor.execute(f"SELECT COUNT(*) AS count FROM `{table_name}`")
                    table_counts[table_name] = int(cursor.fetchone()["count"])

                portfolio = None
                if user_id:
                    cursor.execute(
                        """
                        SELECT p.id, p.name, p.base_currency, p.reporting_currency, u.display_name
                        FROM portfolios p
                        JOIN users u ON u.id = p.user_id
                        WHERE p.user_id = %s
                        ORDER BY p.created_at
                        LIMIT 1
                        """,
                        (user_id,),
                    )
                    portfolio = cursor.fetchone()

        return {
            "ok": True,
            "engine": "mysql",
            "database": self.config.mysql_database,
            "portfolio": portfolio,
            "tables": table_counts,
        }

    def _ensure_user_portfolio(self, cursor, user_id: str) -> str:
        cursor.execute(
            """
            SELECT id
            FROM portfolios
            WHERE user_id = %s
            ORDER BY created_at
            LIMIT 1
            """,
            (user_id,),
        )
        portfolio = cursor.fetchone()

        if portfolio:
            return portfolio["id"]

        portfolio_id = f"portfolio-{uuid.uuid4().hex}"
        cursor.execute(
            """
            INSERT INTO portfolios (id, user_id, name, base_currency, reporting_currency)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (portfolio_id, user_id, "Main Portfolio", "USD", "ILS"),
        )
        return portfolio_id

    def _resolve_portfolio_access(
        self,
        cursor,
        user_id: str,
        portfolio_id: str | None,
        require_write: bool = False,
    ):
        if not portfolio_id:
            portfolio_id = self._ensure_user_portfolio(cursor, user_id)

        cursor.execute(
            """
            SELECT
              p.id,
              p.name,
              p.user_id AS owner_user_id,
              u.display_name AS owner_name,
              u.email AS owner_email,
              p.base_currency,
              p.reporting_currency,
              p.created_at,
              p.updated_at,
              CASE WHEN p.user_id = %s THEN 'OWNER' ELSE 'SHARED' END AS role,
              CASE WHEN p.user_id = %s THEN 'EDIT' ELSE s.permission END AS permission,
              (
                SELECT COUNT(*)
                FROM portfolio_positions pp
                WHERE pp.portfolio_id = p.id
              ) AS holdings_count
            FROM portfolios p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN portfolio_shares s
              ON s.portfolio_id = p.id
             AND s.shared_with_user_id = %s
             AND s.status = 'ACCEPTED'
            WHERE p.id = %s
              AND (p.user_id = %s OR s.shared_with_user_id = %s)
            LIMIT 1
            """,
            (user_id, user_id, user_id, portfolio_id, user_id, user_id),
        )
        portfolio = cursor.fetchone()

        if not portfolio:
            raise PortfolioAccessError("Portfolio not found", status_code=404)

        mapped_portfolio = self._map_portfolio(portfolio)

        if require_write and mapped_portfolio["permission"] != "EDIT":
            raise PortfolioAccessError("You only have view access to this portfolio", status_code=403)

        return portfolio_id, mapped_portfolio

    def _require_portfolio_owner(self, cursor, user_id: str, portfolio_id: str):
        _resolved_id, portfolio = self._resolve_portfolio_access(cursor, user_id, portfolio_id)

        if portfolio["role"] != "OWNER":
            raise PortfolioAccessError("Only the owner can manage portfolio sharing", status_code=403)

        return portfolio

    def _read_portfolio_shares(self, cursor, portfolio_id: str):
        cursor.execute(
            """
            SELECT
              s.id,
              s.permission,
              s.status,
              s.accepted_at,
              s.created_at,
              s.updated_at,
              u.id AS user_id,
              u.email,
              u.display_name
            FROM portfolio_shares s
            JOIN users u ON u.id = s.shared_with_user_id
            WHERE s.portfolio_id = %s
            ORDER BY s.created_at DESC
            """,
            (portfolio_id,),
        )
        return [self._map_share(row) for row in cursor.fetchall()]

    def _read_portfolio_state(self, cursor, portfolio_id: str):
        cursor.execute(
            """
            SELECT *
            FROM portfolio_positions
            WHERE portfolio_id = %s
            ORDER BY created_at, symbol
            """,
            (portfolio_id,),
        )
        holdings = [self._map_position(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT `key`, value
            FROM portfolio_settings
            WHERE portfolio_id = %s
            """,
            (portfolio_id,),
        )
        settings = {row["key"]: parse_json_value(row["value"]) for row in cursor.fetchall()}

        cursor.execute(
            """
            SELECT `key`, value
            FROM market_cache
            WHERE portfolio_id = %s
            """,
            (portfolio_id,),
        )
        cached_market = {row["key"]: parse_json_value(row["value"]) for row in cursor.fetchall()}

        return {
            "holdings": holdings,
            "settings": settings,
            "cachedMarket": normalize_cached_market(cached_market),
        }

    def _replace_portfolio_state(self, cursor, portfolio_id: str, payload) -> None:
        validate_portfolio_payload(payload)

        holdings = payload.get("holdings")
        settings = payload.get("settings")
        cached_market = payload.get("cachedMarket", {})

        cursor.execute(
            "DELETE FROM portfolio_positions WHERE portfolio_id = %s",
            (portfolio_id,),
        )
        cursor.execute(
            "DELETE FROM portfolio_settings WHERE portfolio_id = %s",
            (portfolio_id,),
        )
        cursor.execute(
            "DELETE FROM market_cache WHERE portfolio_id = %s",
            (portfolio_id,),
        )

        for holding in holdings:
            cursor.execute(
                """
                INSERT INTO portfolio_positions (
                  id,
                  portfolio_id,
                  symbol,
                  investment_usd,
                  buy_price,
                  buy_currency,
                  buy_currency_to_usd,
                  shares,
                  created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(holding["id"]),
                    portfolio_id,
                    str(holding["symbol"]).upper(),
                    float(holding["investmentUsd"]),
                    float(holding["buyPrice"]),
                    str(holding.get("buyCurrency", "USD")).upper(),
                    float(holding.get("buyCurrencyToUsd", 1)),
                    float(holding["shares"]),
                    str(holding.get("createdAt", "")),
                ),
            )

        for key, value in settings.items():
            cursor.execute(
                """
                INSERT INTO portfolio_settings (portfolio_id, `key`, value)
                VALUES (%s, %s, %s)
                """,
                (portfolio_id, str(key), json.dumps(value, ensure_ascii=False)),
            )

        for key, value in normalize_cached_market(cached_market).items():
            cursor.execute(
                """
                INSERT INTO market_cache (portfolio_id, `key`, value)
                VALUES (%s, %s, %s)
                """,
                (portfolio_id, key, json.dumps(value, ensure_ascii=False)),
            )

        cursor.execute(
            """
            UPDATE portfolios
            SET updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = %s
            """,
            (portfolio_id,),
        )

    def _has_positions(self, portfolio_id: str) -> bool:
        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM portfolio_positions
                    WHERE portfolio_id = %s
                    """,
                    (portfolio_id,),
                )
                return int(cursor.fetchone()["count"]) > 0

    def _read_legacy_mysql_state(self):
        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                if not table_exists(cursor, "holdings"):
                    return None

                cursor.execute("SELECT * FROM holdings ORDER BY created_at, symbol")
                holdings = [self._map_legacy_holding(row) for row in cursor.fetchall()]

                settings = {}
                if table_exists(cursor, "settings"):
                    cursor.execute("SELECT `key`, value FROM settings")
                    settings = {
                        row["key"]: parse_json_value(row["value"]) for row in cursor.fetchall()
                    }

                cached_market = {}
                if table_exists(cursor, "cached_market"):
                    cursor.execute("SELECT `key`, value FROM cached_market")
                    cached_market = {
                        row["key"]: parse_json_value(row["value"]) for row in cursor.fetchall()
                    }

        return {
            "holdings": holdings,
            "settings": settings,
            "cachedMarket": normalize_cached_market(cached_market),
        }

    def _map_position(self, row):
        return {
            "id": row["id"],
            "symbol": row["symbol"],
            "investmentUsd": float(row["investment_usd"]),
            "buyPrice": float(row["buy_price"]),
            "buyCurrency": row["buy_currency"],
            "buyCurrencyToUsd": float(row["buy_currency_to_usd"]),
            "shares": float(row["shares"]),
            "createdAt": row["created_at"],
        }

    def _map_legacy_holding(self, row):
        return {
            "id": row["id"],
            "symbol": row["symbol"],
            "investmentUsd": float(row["investment_usd"]),
            "buyPrice": float(row["buy_price"]),
            "buyCurrency": row["buy_currency"],
            "buyCurrencyToUsd": float(row["buy_currency_to_usd"]),
            "shares": float(row["shares"]),
            "createdAt": row["created_at"],
        }

    def _map_portfolio(self, row):
        return {
            "id": row["id"],
            "name": row["name"],
            "ownerUserId": row["owner_user_id"],
            "ownerName": row.get("owner_name"),
            "ownerEmail": row.get("owner_email"),
            "baseCurrency": row.get("base_currency", "USD"),
            "reportingCurrency": row.get("reporting_currency", "ILS"),
            "role": row.get("role", "OWNER"),
            "permission": row.get("permission", "EDIT"),
            "holdingsCount": int(row.get("holdings_count") or 0),
            "createdAt": serialize_datetime(row.get("created_at")),
            "updatedAt": serialize_datetime(row.get("updated_at")),
        }

    def _map_share(self, row):
        return {
            "id": row["id"],
            "userId": row["user_id"],
            "email": row["email"],
            "displayName": row["display_name"],
            "permission": row["permission"],
            "status": row.get("status", "ACCEPTED"),
            "acceptedAt": serialize_datetime(row.get("accepted_at")),
            "createdAt": serialize_datetime(row.get("created_at")),
            "updatedAt": serialize_datetime(row.get("updated_at")),
        }

    def _map_share_request(self, row):
        return {
            "id": row["id"],
            "portfolioId": row["portfolio_id"],
            "portfolioName": row["portfolio_name"],
            "ownerUserId": row["owner_user_id"],
            "ownerName": row.get("owner_name"),
            "ownerEmail": row.get("owner_email"),
            "permission": row["permission"],
            "status": row.get("status", "PENDING"),
            "createdAt": serialize_datetime(row.get("created_at")),
            "updatedAt": serialize_datetime(row.get("updated_at")),
        }


def clean_portfolio_name(value) -> str:
    name = str(value or "").strip()

    if not name:
        raise ValueError("Portfolio name is required")

    return name[:120]


def normalize_share_permission(value) -> str:
    permission = str(value or "VIEW").strip().upper()

    if permission not in {"VIEW", "EDIT"}:
        raise ValueError("Share permission must be VIEW or EDIT")

    return permission


def serialize_datetime(value):
    if not value:
        return None

    if hasattr(value, "isoformat"):
        return value.isoformat()

    return str(value)


def validate_portfolio_payload(payload) -> None:
    if not isinstance(payload.get("holdings"), list) or not isinstance(payload.get("settings"), dict):
        raise ValueError("Invalid portfolio state")


def read_sqlite_portfolio(path: Path):
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row

    try:
        holdings = [
            {
                "id": row["id"],
                "symbol": row["symbol"],
                "investmentUsd": row["investment_usd"],
                "buyPrice": row["buy_price"],
                "buyCurrency": row["buy_currency"],
                "buyCurrencyToUsd": row["buy_currency_to_usd"],
                "shares": row["shares"],
                "createdAt": row["created_at"],
            }
            for row in connection.execute("SELECT * FROM holdings ORDER BY created_at, symbol")
        ]
        settings = {
            row["key"]: json.loads(row["value"])
            for row in connection.execute("SELECT key, value FROM settings")
        }
        cached_market = {
            row["key"]: json.loads(row["value"])
            for row in connection.execute("SELECT key, value FROM cached_market")
        }
    finally:
        connection.close()

    return {
        "holdings": holdings,
        "settings": settings,
        "cachedMarket": normalize_cached_market(cached_market),
    }


def table_exists(cursor, table_name: str) -> bool:
    cursor.execute("SHOW TABLES LIKE %s", (table_name,))
    return cursor.fetchone() is not None


def parse_json_value(value):
    if value is None:
        return None

    if isinstance(value, (dict, list, int, float, bool)):
        return value

    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")

    return json.loads(value)


def normalize_cached_market(cached_market):
    cached_market = cached_market or {}

    return {
        "fxRate": cached_market.get("fxRate"),
        "currencyRates": cached_market.get("currencyRates", {}),
        "quotes": cached_market.get("quotes", {}),
        "lastUpdated": cached_market.get("lastUpdated"),
    }
