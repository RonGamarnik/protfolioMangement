from __future__ import annotations

from http.server import ThreadingHTTPServer

from .config import load_config
from .auth import AuthRepository
from .database import initialize_mysql
from .http_handler import create_handler
from .repository import PortfolioRepository


def run() -> None:
    config = load_config()
    initialize_mysql(config)

    repository = PortfolioRepository(config)
    auth_repository = AuthRepository(config)
    auth_repository.prune_expired_sessions()
    repository.migrate_legacy_mysql_if_needed()
    repository.migrate_sqlite_if_needed()

    port = config.port
    handler = create_handler(config, repository, auth_repository)

    while True:
        try:
            server = ThreadingHTTPServer((config.host, port), handler)
            break
        except OSError:
            port += 1

    print(f"Portfolio Live running at http://{config.host}:{port}")
    print(
        "MySQL information system: "
        f"{config.mysql_user}@{config.mysql_host}:{config.mysql_port}/{config.mysql_database}"
    )
    server.serve_forever()
