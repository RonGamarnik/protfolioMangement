from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse


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
    default_host = (
        "0.0.0.0"
        if app_env.lower() == "production" or os.environ.get("RAILWAY_ENVIRONMENT")
        else "127.0.0.1"
    )
    mysql = load_mysql_settings(app_env)

    return AppConfig(
        root=ROOT,
        app_env=app_env,
        host=os.environ.get("HOST", default_host),
        port=int(os.environ.get("PORT", "4173")),
        mysql_host=mysql["host"],
        mysql_port=int(mysql["port"]),
        mysql_user=mysql["user"],
        mysql_password=mysql["password"],
        mysql_database=mysql["database"],
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
        smtp_ssl=os.environ.get(
            "SMTP_SSL",
            "1" if int(os.environ.get("SMTP_PORT", "587")) == 465 else "0",
        )
        == "1",
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        openai_model=os.environ.get("OPENAI_MODEL", "gpt-5.2"),
    )


def load_mysql_settings(app_env: str) -> dict[str, str | int]:
    is_deployed = app_env.lower() == "production" or bool(os.environ.get("RAILWAY_ENVIRONMENT"))
    raw_mysql_url = first_env("MYSQL_URL", "MYSQL_PRIVATE_URL", "MYSQL_PUBLIC_URL", "DATABASE_URL")
    url_settings = parse_mysql_url(raw_mysql_url)

    if is_deployed:
        host = url_settings.get("host") or first_env("MYSQLHOST", "MYSQL_HOST", default="127.0.0.1")
        port = url_settings.get("port") or first_env("MYSQLPORT", "MYSQL_PORT", default="3306")
        user = url_settings.get("user") or first_env("MYSQLUSER", "MYSQL_USER", default="root")
        password = url_settings.get("password") or first_env(
            "MYSQLPASSWORD",
            "MYSQL_ROOT_PASSWORD",
            "MYSQL_PASSWORD",
            default="",
        )
        database = url_settings.get("database") or first_env(
            "MYSQLDATABASE",
            "MYSQL_DATABASE",
            default="portfolio_live",
        )
    else:
        host = first_env("MYSQL_HOST", "MYSQLHOST", default=url_settings.get("host") or "127.0.0.1")
        port = first_env("MYSQL_PORT", "MYSQLPORT", default=url_settings.get("port") or "3305")
        user = first_env("MYSQL_USER", "MYSQLUSER", default=url_settings.get("user") or "root")
        password = first_env(
            "MYSQL_PASSWORD",
            "MYSQLPASSWORD",
            "MYSQL_ROOT_PASSWORD",
            default=url_settings.get("password") or "",
        )
        database = first_env(
            "MYSQL_DATABASE",
            "MYSQLDATABASE",
            default=url_settings.get("database") or "portfolio_live",
        )

    if is_deployed and is_local_mysql_host(str(host)):
        raise RuntimeError(
            "MySQL is still pointing at a local host in production. Add a Railway MySQL service "
            "and expose MYSQL_URL, or set MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD and "
            "MYSQLDATABASE. Remove MYSQL_HOST=127.0.0.1 from the Railway web service. "
            f"Detected MySQL env: {describe_mysql_environment(raw_mysql_url, url_settings, host)}"
        )

    return {
        "host": str(host),
        "port": int(port),
        "user": str(user),
        "password": str(password),
        "database": str(database),
    }


def parse_mysql_url(value: str | None) -> dict[str, str | int]:
    if not value:
        return {}

    parsed = urlparse(clean_env_value(value.strip()))

    if parsed.scheme not in {"mysql", "mysql+pymysql"}:
        return {}

    database = parsed.path.lstrip("/").split("/", 1)[0]

    return {
        "host": parsed.hostname or "",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": unquote(database or ""),
    }


def is_local_mysql_host(value: str) -> bool:
    return value.strip().lower() in {"127.0.0.1", "localhost", "::1", "0.0.0.0"}


def describe_mysql_environment(
    raw_mysql_url: str | None,
    url_settings: dict[str, str | int],
    selected_host: str | int | None,
) -> str:
    keys = (
        "MYSQL_URL",
        "MYSQL_PRIVATE_URL",
        "MYSQL_PUBLIC_URL",
        "DATABASE_URL",
        "MYSQLHOST",
        "MYSQL_HOST",
        "MYSQLPORT",
        "MYSQL_PORT",
        "MYSQLUSER",
        "MYSQL_USER",
        "MYSQLPASSWORD",
        "MYSQL_PASSWORD",
        "MYSQLDATABASE",
        "MYSQL_DATABASE",
    )
    present_keys = [key for key in keys if os.environ.get(key) not in (None, "")]
    url_state = "missing"

    if raw_mysql_url:
        parsed = urlparse(clean_env_value(raw_mysql_url.strip()))
        url_state = (
            f"present scheme={parsed.scheme or 'none'} "
            f"host={parsed.hostname or 'not-parsed'} "
            f"parsed_host={url_settings.get('host') or 'none'}"
        )

    return (
        f"present_keys={present_keys or ['none']}; "
        f"url={url_state}; selected_host={selected_host}"
    )


def first_env(*keys: str, default: str | int | None = None):
    for key in keys:
        value = os.environ.get(key)

        if value not in (None, ""):
            return value

    return default


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
