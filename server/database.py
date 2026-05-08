from __future__ import annotations

import re

try:
    import pymysql
    from pymysql.cursors import DictCursor
except ModuleNotFoundError as error:
    raise SystemExit(
        "PyMySQL is required for MySQL storage. Run: pip install -r requirements.txt"
    ) from error

from .config import AppConfig


DEFAULT_USER_ID = "local-user"
DEFAULT_PORTFOLIO_ID = "default-portfolio"


TABLE_NAMES = [
    "users",
    "user_sessions",
    "password_reset_tokens",
    "portfolios",
    "portfolio_positions",
    "portfolio_transactions",
    "portfolio_shares",
    "portfolio_settings",
    "market_symbols",
    "market_cache",
    "fx_rates",
    "audit_events",
]


SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      email VARCHAR(190) NULL,
      password_hash VARCHAR(128) NULL,
      password_salt VARCHAR(128) NULL,
      display_name VARCHAR(120) NOT NULL,
      base_currency VARCHAR(12) NOT NULL DEFAULT 'USD',
      last_login_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS user_sessions (
      id_hash CHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      user_agent VARCHAR(255) NULL,
      ip_address VARCHAR(80) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expires_at DATETIME(3) NOT NULL,
      CONSTRAINT fk_sessions_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,
      INDEX idx_sessions_user_expires (user_id, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id_hash CHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      request_ip VARCHAR(80) NULL,
      user_agent VARCHAR(255) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expires_at DATETIME(3) NOT NULL,
      used_at DATETIME(3) NULL,
      attempts INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_password_reset_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,
      INDEX idx_password_reset_user_active (user_id, used_at, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS portfolios (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      base_currency VARCHAR(12) NOT NULL DEFAULT 'USD',
      reporting_currency VARCHAR(12) NOT NULL DEFAULT 'ILS',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_portfolios_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,
      INDEX idx_portfolios_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS portfolio_positions (
      id VARCHAR(64) PRIMARY KEY,
      portfolio_id VARCHAR(64) NOT NULL,
      symbol VARCHAR(40) NOT NULL,
      investment_usd DECIMAL(18, 6) NOT NULL,
      buy_price DECIMAL(18, 6) NOT NULL,
      buy_currency VARCHAR(12) NOT NULL,
      buy_currency_to_usd DECIMAL(18, 10) NOT NULL,
      shares DECIMAL(24, 10) NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_positions_portfolio
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
        ON DELETE CASCADE,
      INDEX idx_positions_portfolio_symbol (portfolio_id, symbol),
      INDEX idx_positions_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS portfolio_transactions (
      id VARCHAR(64) PRIMARY KEY,
      portfolio_id VARCHAR(64) NOT NULL,
      position_id VARCHAR(64) NULL,
      symbol VARCHAR(40) NOT NULL,
      action ENUM('BUY', 'SELL', 'ADJUSTMENT') NOT NULL,
      quantity DECIMAL(24, 10) NOT NULL,
      price DECIMAL(18, 6) NOT NULL,
      currency VARCHAR(12) NOT NULL,
      amount_usd DECIMAL(18, 6) NOT NULL,
      trade_date DATE NULL,
      notes VARCHAR(500) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_transactions_portfolio
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_transactions_position
        FOREIGN KEY (position_id) REFERENCES portfolio_positions(id)
        ON DELETE SET NULL,
      INDEX idx_transactions_portfolio_symbol (portfolio_id, symbol),
      INDEX idx_transactions_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS portfolio_shares (
      id VARCHAR(64) PRIMARY KEY,
      portfolio_id VARCHAR(64) NOT NULL,
      shared_with_user_id VARCHAR(64) NOT NULL,
      permission ENUM('VIEW', 'EDIT') NOT NULL DEFAULT 'VIEW',
      status ENUM('PENDING', 'ACCEPTED') NOT NULL DEFAULT 'PENDING',
      accepted_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_portfolio_shares_portfolio
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_portfolio_shares_user
        FOREIGN KEY (shared_with_user_id) REFERENCES users(id)
        ON DELETE CASCADE,
      UNIQUE KEY uq_portfolio_share_user (portfolio_id, shared_with_user_id),
      INDEX idx_portfolio_shares_user (shared_with_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS portfolio_settings (
      portfolio_id VARCHAR(64) NOT NULL,
      `key` VARCHAR(80) NOT NULL,
      value JSON NOT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (portfolio_id, `key`),
      CONSTRAINT fk_settings_portfolio
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS market_symbols (
      symbol VARCHAR(40) PRIMARY KEY,
      exchange_code VARCHAR(40) NULL,
      exchange_name VARCHAR(120) NULL,
      currency VARCHAR(12) NULL,
      source VARCHAR(40) NULL,
      last_price DECIMAL(18, 6) NULL,
      last_checked_at DATETIME(3) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_market_symbols_exchange (exchange_code),
      INDEX idx_market_symbols_currency (currency)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS market_cache (
      portfolio_id VARCHAR(64) NOT NULL,
      `key` VARCHAR(80) NOT NULL,
      value JSON NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (portfolio_id, `key`),
      CONSTRAINT fk_market_cache_portfolio
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS fx_rates (
      base_currency VARCHAR(12) NOT NULL,
      quote_currency VARCHAR(12) NOT NULL,
      rate DECIMAL(20, 10) NOT NULL,
      source VARCHAR(40) NULL,
      fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (base_currency, quote_currency)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      portfolio_id VARCHAR(64) NULL,
      event_type VARCHAR(80) NOT NULL,
      payload JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_audit_portfolio
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
        ON DELETE SET NULL,
      INDEX idx_audit_portfolio_created_at (portfolio_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
]


def server_connection(config: AppConfig):
    return pymysql.connect(
        host=config.mysql_host,
        port=config.mysql_port,
        user=config.mysql_user,
        password=config.mysql_password,
        charset="utf8mb4",
        autocommit=True,
        cursorclass=DictCursor,
    )


def connect(config: AppConfig):
    return pymysql.connect(
        host=config.mysql_host,
        port=config.mysql_port,
        user=config.mysql_user,
        password=config.mysql_password,
        database=config.mysql_database,
        charset="utf8mb4",
        autocommit=False,
        cursorclass=DictCursor,
    )


def initialize_mysql(config: AppConfig) -> None:
    try:
        ensure_schema(config)
        return
    except pymysql.err.OperationalError as error:
        if error.args[0] != 1049:
            raise

    database = mysql_identifier(config.mysql_database)

    try:
        with server_connection(config) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"CREATE DATABASE IF NOT EXISTS `{database}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
    except pymysql.err.OperationalError as error:
        if error.args[0] == 1044:
            raise RuntimeError(
                f"MySQL user '{config.mysql_user}' cannot create database "
                f"'{config.mysql_database}'. Create it with an admin user and "
                "grant privileges, then rerun."
            ) from error
        raise

    ensure_schema(config)


def ensure_schema(config: AppConfig) -> None:
    with connect(config) as connection:
        with connection.cursor() as cursor:
            for statement in SCHEMA_STATEMENTS:
                cursor.execute(statement)

            ensure_auth_columns(cursor)
            ensure_password_reset_columns(cursor)
            ensure_share_columns(cursor)
            ensure_default_identity(cursor)

        connection.commit()


def ensure_auth_columns(cursor) -> None:
    ensure_column(cursor, "users", "email", "VARCHAR(190) NULL")
    ensure_column(cursor, "users", "password_hash", "VARCHAR(128) NULL")
    ensure_column(cursor, "users", "password_salt", "VARCHAR(128) NULL")
    ensure_column(cursor, "users", "last_login_at", "DATETIME(3) NULL")
    ensure_index(cursor, "users", "uq_users_email", "CREATE UNIQUE INDEX uq_users_email ON users (email)")


def ensure_password_reset_columns(cursor) -> None:
    ensure_column(cursor, "password_reset_tokens", "attempts", "INT NOT NULL DEFAULT 0")


def ensure_share_columns(cursor) -> None:
    ensure_column(
        cursor,
        "portfolio_shares",
        "status",
        "ENUM('PENDING', 'ACCEPTED') NOT NULL DEFAULT 'PENDING'",
    )
    ensure_column(cursor, "portfolio_shares", "accepted_at", "DATETIME(3) NULL")


def ensure_default_identity(cursor) -> None:
    cursor.execute(
        """
        INSERT INTO users (id, display_name, base_currency)
        VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)
        """,
        (DEFAULT_USER_ID, "Local User", "USD"),
    )
    cursor.execute(
        """
        INSERT INTO portfolios (id, user_id, name, base_currency, reporting_currency)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)
        """,
        (DEFAULT_PORTFOLIO_ID, DEFAULT_USER_ID, "Main Portfolio", "USD", "ILS"),
    )


def ensure_column(cursor, table_name: str, column_name: str, definition: str) -> None:
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (table_name, column_name),
    )

    if int(cursor.fetchone()["count"]) == 0:
        cursor.execute(f"ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` {definition}")


def ensure_index(cursor, table_name: str, index_name: str, statement: str) -> None:
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
        """,
        (table_name, index_name),
    )

    if int(cursor.fetchone()["count"]) == 0:
        cursor.execute(statement)


def mysql_identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]+", value):
        raise ValueError("MYSQL_DATABASE may contain only letters, numbers and underscores")

    return value
