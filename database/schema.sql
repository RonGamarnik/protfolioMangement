CREATE DATABASE IF NOT EXISTS portfolio_live
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE portfolio_live;

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
    ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fx_rates (
  base_currency VARCHAR(12) NOT NULL,
  quote_currency VARCHAR(12) NOT NULL,
  rate DECIMAL(20, 10) NOT NULL,
  source VARCHAR(40) NULL,
  fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (base_currency, quote_currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO users (id, display_name, base_currency)
VALUES ('local-user', 'Local User', 'USD')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO portfolios (id, user_id, name, base_currency, reporting_currency)
VALUES ('default-portfolio', 'local-user', 'Main Portfolio', 'USD', 'ILS')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3);
