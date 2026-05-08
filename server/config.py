from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_FILES = (ROOT / ".env", ROOT / ".ENV")


@dataclass(frozen=True)
class AppConfig:
    root: Path
    app_env: str
    host: str
    port: int
    mysql_host: str
    mysql_port: int
    mysql_user: str
    mysql_password: str
    mysql_database: str
    migrate_sqlite: bool
    sqlite_migration_path: Path
    app_base_url: str
    password_reset_token_minutes: int
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_from: str
    smtp_tls: bool
    smtp_ssl: bool
    openai_api_key: str
    openai_model: str

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"


def load_config() -> AppConfig:
    load_env_files()
    app_env = os.environ.get("APP_ENV", "development")
    default_host = "0.0.0.0" if app_env.lower() == "production" or os.environ.get("RAILWAY_ENVIRONMENT") else "127.0.0.1"

    return AppConfig(
        root=ROOT,
        app_env=app_env,
        host=os.environ.get("HOST", default_host),
        port=int(os.environ.get("PORT", "4173")),
        mysql_host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        mysql_port=int(os.environ.get("MYSQL_PORT", "3305")),
        mysql_user=os.environ.get("MYSQL_USER", "root"),
        mysql_password=os.environ.get("MYSQL_PASSWORD", ""),
        mysql_database=os.environ.get("MYSQL_DATABASE", "portfolio_live"),
        migrate_sqlite=os.environ.get("MIGRATE_SQLITE", "1") == "1",
        sqlite_migration_path=ROOT / "data" / "portfolio.db",
        app_base_url=os.environ.get("APP_BASE_URL", "http://127.0.0.1:4173"),
        password_reset_token_minutes=int(os.environ.get("PASSWORD_RESET_TOKEN_MINUTES", "30")),
        smtp_host=os.environ.get("SMTP_HOST", ""),
        smtp_port=int(os.environ.get("SMTP_PORT", "587")),
        smtp_user=os.environ.get("SMTP_USER", ""),
        smtp_password=os.environ.get("SMTP_PASSWORD", ""),
        smtp_from=os.environ.get("SMTP_FROM", ""),
        smtp_tls=os.environ.get("SMTP_TLS", "1") == "1",
        smtp_ssl=os.environ.get("SMTP_SSL", "1" if int(os.environ.get("SMTP_PORT", "587")) == 465 else "0") == "1",
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        openai_model=os.environ.get("OPENAI_MODEL", "gpt-5.2"),
    )


def load_env_files() -> None:
    for path in ENV_FILES:
        if path.exists():
            load_env_file(path)


def load_env_file(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()

        if not stripped or stripped.startswith("#"):
            continue

        if stripped.startswith("export "):
            stripped = stripped.removeprefix("export ").strip()

        key, separator, value = stripped.partition("=")

        if not separator:
            continue

        key = key.strip()

        if not key or key in os.environ:
            continue

        os.environ[key] = clean_env_value(value.strip())


def clean_env_value(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]

    return value
