from __future__ import annotations

import json
import mimetypes
import time
from http.server import SimpleHTTPRequestHandler
from urllib.parse import parse_qs, unquote, urlparse

from .auth import AuthError
from .ai import create_portfolio_insights
from .repository import PortfolioAccessError


MAX_JSON_BODY_BYTES = 1_000_000
RATE_LIMITS = {}
RATE_LIMIT_WINDOW_SECONDS = 15 * 60
AUTH_RATE_LIMIT_MAX = 20
RESET_RATE_LIMIT_MAX = 5
AI_RATE_LIMIT_MAX = 15


def create_handler(config, repository, auth_repository):
    class PortfolioRequestHandler(SimpleHTTPRequestHandler):
        server_version = "PortfolioLiveInformationSystem/3.0"

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            segments = path_segments(path)

            if path == "/api/auth/me":
                user = auth_repository.current_user(self.get_bearer_token())
                self.send_json({"authenticated": bool(user), "user": user})
                return

            if path == "/api/portfolios":
                user = self.require_user()
                if not user:
                    return

                self.handle_repository_action(repository.list_portfolios, user["id"])
                return

            if path == "/api/portfolio-share-requests":
                user = self.require_user()
                if not user:
                    return

                self.handle_repository_action(repository.list_share_requests, user["id"])
                return

            if path == "/api/portfolio":
                user = self.require_user()
                if not user:
                    return

                portfolio_id = self.get_query_value("portfolioId") or self.get_query_value("id")
                self.handle_repository_action(repository.read_portfolio, user["id"], portfolio_id)
                return

            if (
                len(segments) == 4
                and segments[0] == "api"
                and segments[1] == "portfolios"
                and segments[3] == "shares"
            ):
                user = self.require_user()
                if not user:
                    return

                self.handle_repository_action(
                    repository.list_portfolio_shares,
                    user["id"],
                    segments[2],
                )
                return

            if path == "/api/health":
                self.send_json(
                    {
                        "ok": True,
                        "database": config.mysql_database,
                        "engine": "mysql",
                        "schema": "portfolio_information_system",
                    }
                )
                return

            if path == "/api/system":
                user = self.require_user()
                if not user:
                    return

                self.send_json(repository.system_snapshot(user["id"]))
                return

            if path.startswith("/api/"):
                self.send_json({"error": "API route not found"}, status=404)
                return

            self.serve_static()

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            segments = path_segments(path)

            if path == "/api/auth/register":
                if not self.require_rate_limit("auth-register", AUTH_RATE_LIMIT_MAX):
                    return

                self.handle_auth_action(auth_repository.register)
                return

            if path == "/api/auth/login":
                if not self.require_rate_limit("auth-login", AUTH_RATE_LIMIT_MAX):
                    return

                self.handle_auth_action(auth_repository.login)
                return

            if path == "/api/auth/request-password-reset":
                if not self.require_rate_limit("password-reset", RESET_RATE_LIMIT_MAX):
                    return

                self.handle_password_reset_request()
                return

            if path == "/api/auth/confirm-password-reset":
                if not self.require_rate_limit("password-reset-confirm", RESET_RATE_LIMIT_MAX):
                    return

                self.handle_password_reset_confirm()
                return

            if path == "/api/auth/reset-password":
                if not self.require_rate_limit("password-reset-confirm", RESET_RATE_LIMIT_MAX):
                    return

                self.handle_password_reset_confirm()
                return

            if path == "/api/auth/logout":
                auth_repository.logout(self.get_bearer_token())
                self.send_json({"ok": True})
                return

            if path == "/api/ai/portfolio-insights":
                user = self.require_user()
                if not user:
                    return

                if not self.require_rate_limit(f"ai:{user['id']}", AI_RATE_LIMIT_MAX):
                    return

                self.handle_ai_insights()
                return

            if path == "/api/portfolios":
                user = self.require_user()
                if not user:
                    return

                payload = self.read_json_body()
                self.handle_repository_action(repository.create_portfolio, user["id"], payload)
                return

            if (
                len(segments) == 4
                and segments[0] == "api"
                and segments[1] == "portfolio-share-requests"
                and segments[3] == "accept"
            ):
                user = self.require_user()
                if not user:
                    return

                self.handle_repository_action(
                    repository.accept_portfolio_share,
                    user["id"],
                    segments[2],
                )
                return

            if (
                len(segments) == 4
                and segments[0] == "api"
                and segments[1] == "portfolios"
                and segments[3] == "shares"
            ):
                user = self.require_user()
                if not user:
                    return

                payload = self.read_json_body()
                self.handle_repository_action(
                    repository.share_portfolio,
                    user["id"],
                    segments[2],
                    payload,
                )
                return

            self.send_json({"error": "API route not found"}, status=404)

        def do_PUT(self) -> None:
            path = urlparse(self.path).path
            segments = path_segments(path)

            user = self.require_user()
            if not user:
                return

            if path == "/api/portfolio":
                payload = self.read_json_body()
                portfolio_id = self.get_query_value("portfolioId") or self.get_query_value("id")
                self.handle_repository_action(
                    repository.write_portfolio,
                    user["id"],
                    payload,
                    portfolio_id,
                    success_payload={"ok": True},
                )
                return

            if len(segments) == 3 and segments[0] == "api" and segments[1] == "portfolios":
                payload = self.read_json_body()
                self.handle_repository_action(
                    repository.rename_portfolio,
                    user["id"],
                    segments[2],
                    payload,
                )
                return

            self.send_json({"error": "API route not found"}, status=404)

        def do_DELETE(self) -> None:
            path = urlparse(self.path).path
            segments = path_segments(path)

            user = self.require_user()
            if not user:
                return

            if len(segments) == 3 and segments[0] == "api" and segments[1] == "portfolios":
                self.handle_repository_action(
                    repository.delete_portfolio,
                    user["id"],
                    segments[2],
                    success_payload={"ok": True},
                )
                return

            if (
                len(segments) == 3
                and segments[0] == "api"
                and segments[1] == "portfolio-share-requests"
            ):
                self.handle_repository_action(
                    repository.decline_portfolio_share,
                    user["id"],
                    segments[2],
                    success_payload={"ok": True},
                )
                return

            if (
                len(segments) == 5
                and segments[0] == "api"
                and segments[1] == "portfolios"
                and segments[3] == "shares"
            ):
                self.handle_repository_action(
                    repository.revoke_portfolio_share,
                    user["id"],
                    segments[2],
                    segments[4],
                    success_payload={"ok": True},
                )
                return

            self.send_json({"error": "API route not found"}, status=404)

        def handle_auth_action(self, action) -> None:
            try:
                payload = self.read_json_body()
                user = action(payload)
                token = auth_repository.create_session(
                    user["id"],
                    self.headers.get("User-Agent"),
                    self.client_address[0] if self.client_address else None,
                )
                self.send_json({"authenticated": True, "user": user, "token": token})
            except AuthError as error:
                self.send_json({"error": str(error)}, status=error.status_code)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
            except Exception as error:
                print(error)
                self.send_json({"error": "Authentication failed"}, status=500)

        def handle_password_reset_request(self) -> None:
            try:
                payload = self.read_json_body()
                result = auth_repository.request_password_reset(
                    payload,
                    self.headers.get("User-Agent"),
                    self.client_address[0] if self.client_address else None,
                )
                self.send_json(result)
            except AuthError as error:
                self.send_json({"error": str(error)}, status=error.status_code)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
            except Exception as error:
                print(error)
                self.send_json({"error": "Password reset request failed"}, status=500)

        def handle_password_reset_confirm(self) -> None:
            try:
                payload = self.read_json_body()
                self.send_json(auth_repository.confirm_password_reset(payload))
            except AuthError as error:
                self.send_json({"error": str(error)}, status=error.status_code)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
            except Exception as error:
                print(error)
                self.send_json({"error": "Password reset failed"}, status=500)

        def handle_ai_insights(self) -> None:
            try:
                payload = self.read_json_body()
                self.send_json(create_portfolio_insights(config, payload))
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
            except Exception as error:
                print(error)
                self.send_json({"error": "AI insights failed"}, status=500)

        def handle_repository_action(self, action, *args, success_payload=None) -> None:
            try:
                payload = action(*args)
                self.send_json(success_payload if success_payload is not None else payload)
            except PortfolioAccessError as error:
                self.send_json({"error": str(error)}, status=error.status_code)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
            except Exception as error:
                print(error)
                self.send_json({"error": "Portfolio action failed"}, status=500)

        def require_user(self):
            user = auth_repository.current_user(self.get_bearer_token())

            if not user:
                self.send_json({"error": "Authentication required"}, status=401)
                return None

            return user

        def require_rate_limit(
            self,
            bucket: str,
            max_requests: int,
            window_seconds: int = RATE_LIMIT_WINDOW_SECONDS,
        ) -> bool:
            client_ip = self.client_address[0] if self.client_address else "unknown"
            key = f"{bucket}:{client_ip}"
            now = time.monotonic()
            recent = [
                timestamp
                for timestamp in RATE_LIMITS.get(key, [])
                if now - timestamp < window_seconds
            ]

            if len(recent) >= max_requests:
                RATE_LIMITS[key] = recent
                self.send_json({"error": "Too many requests. Try again later."}, status=429)
                return False

            recent.append(now)
            RATE_LIMITS[key] = recent
            return True

        def get_bearer_token(self) -> str | None:
            header = self.headers.get("Authorization", "")

            if not header.startswith("Bearer "):
                return None

            token = header.removeprefix("Bearer ").strip()
            return token or None

        def read_json_body(self):
            length = int(self.headers.get("Content-Length", "0") or "0")

            if length > MAX_JSON_BODY_BYTES:
                raise ValueError("Request body is too large")

            body = self.rfile.read(length)
            payload = json.loads(body.decode("utf-8") or "{}")

            if not isinstance(payload, dict):
                raise ValueError("JSON body must be an object")

            return payload

        def get_query_value(self, key: str) -> str | None:
            values = parse_qs(urlparse(self.path).query).get(key)
            return values[0].strip() if values and values[0].strip() else None

        def serve_static(self) -> None:
            parsed = urlparse(self.path)
            relative_path = "index.html" if parsed.path == "/" else unquote(parsed.path).lstrip("/")
            file_path = (config.root / relative_path).resolve()

            try:
                file_path.relative_to(config.root)
            except ValueError:
                self.send_error(404)
                return

            if not file_path.exists() or file_path.is_dir():
                self.send_error(404)
                return

            content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_security_headers()
            self.end_headers()

            with file_path.open("rb") as file:
                self.wfile.write(file.read())

        def send_json(self, payload, status: int = 200) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.send_security_headers()
            self.end_headers()
            self.wfile.write(body)

        def send_security_headers(self) -> None:
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header(
                "Permissions-Policy",
                "camera=(), microphone=(), geolocation=(), payment=()",
            )
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; "
                "script-src 'self' https://unpkg.com; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data:; "
                "font-src 'self'; "
                "connect-src 'self' https://query1.finance.yahoo.com https://api.allorigins.win "
                "https://corsproxy.io https://stooq.com https://api.frankfurter.dev; "
                "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
            )

        def log_message(self, format: str, *args) -> None:
            return

    return PortfolioRequestHandler


def path_segments(path: str):
    return [unquote(segment) for segment in path.strip("/").split("/") if segment]
