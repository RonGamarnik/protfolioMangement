from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import smtplib
import uuid
from datetime import datetime, timedelta
from email.message import EmailMessage

from .config import AppConfig
from .database import DEFAULT_PORTFOLIO_ID, connect


SESSION_DAYS = 14
PBKDF2_ITERATIONS = 210_000
RESET_CODE_DIGITS = 6
RESET_TOKEN_MINUTES_FALLBACK = 30
RESET_REQUEST_WINDOW_MINUTES = 15
RESET_REQUEST_LIMIT = 3
RESET_CONFIRM_ATTEMPT_LIMIT = 5


class AuthError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class AuthRepository:
    def __init__(self, config: AppConfig):
        self.config = config

    def register(self, payload):
        email = normalize_email(payload.get("email"))
        password = str(payload.get("password") or "")
        display_name = str(payload.get("displayName") or "").strip()

        if not display_name:
            display_name = email.split("@", 1)[0]

        validate_email(email)
        validate_password(password)

        user_id = f"user-{uuid.uuid4().hex}"
        password_salt, password_hash = hash_password(password)

        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT COUNT(*) AS count FROM users WHERE email IS NOT NULL")
                    real_accounts_before = int(cursor.fetchone()["count"])

                    cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
                    if cursor.fetchone():
                        raise AuthError("קיים כבר חשבון עם האימייל הזה", status_code=409)

                    cursor.execute(
                        """
                        INSERT INTO users (
                          id,
                          email,
                          password_hash,
                          password_salt,
                          display_name,
                          base_currency
                        ) VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (user_id, email, password_hash, password_salt, display_name[:120], "USD"),
                    )
                    self._create_initial_portfolio(cursor, user_id, real_accounts_before)

                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return self._user_payload(
            {
                "id": user_id,
                "email": email,
                "display_name": display_name,
                "base_currency": "USD",
            }
        )

    def login(self, payload):
        email = normalize_email(payload.get("email"))
        password = str(payload.get("password") or "")

        validate_email(email)

        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, email, password_hash, password_salt, display_name, base_currency
                    FROM users
                    WHERE email = %s
                    """,
                    (email,),
                )
                user = cursor.fetchone()

                if not user:
                    raise AuthError("לא נמצא חשבון עם האימייל הזה", status_code=401)

                if not verify_password(
                    password,
                    user.get("password_salt"),
                    user.get("password_hash"),
                ):
                    raise AuthError("הסיסמה לא נכונה", status_code=401)

                cursor.execute(
                    "UPDATE users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = %s",
                    (user["id"],),
                )
                connection.commit()

        return self._user_payload(user)

    def request_password_reset(
        self,
        payload,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ):
        email = normalize_email(payload.get("email"))
        validate_email(email)

        response = {
            "ok": True,
            "message": "If an account exists for this email, a reset code was sent.",
        }
        reset_code = None

        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT id, email, display_name, base_currency
                        FROM users
                        WHERE email = %s
                        """,
                        (email,),
                    )
                    user = cursor.fetchone()

                    if not user:
                        connection.commit()
                        return response

                    cursor.execute(
                        """
                        DELETE FROM password_reset_tokens
                        WHERE expires_at <= CURRENT_TIMESTAMP(3)
                           OR used_at IS NOT NULL
                        """
                    )
                    cursor.execute(
                        """
                        SELECT COUNT(*) AS count
                        FROM password_reset_tokens
                        WHERE user_id = %s
                          AND created_at > DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL %s MINUTE)
                        """,
                        (user["id"], RESET_REQUEST_WINDOW_MINUTES),
                    )

                    if int(cursor.fetchone()["count"]) >= RESET_REQUEST_LIMIT:
                        connection.commit()
                        return response

                    reset_code = create_reset_code()

                    cursor.execute(
                        """
                        UPDATE password_reset_tokens
                        SET used_at = CURRENT_TIMESTAMP(3)
                        WHERE user_id = %s
                          AND used_at IS NULL
                        """,
                        (user["id"],),
                    )
                    cursor.execute(
                        """
                        INSERT INTO password_reset_tokens (
                          id_hash,
                          user_id,
                          request_ip,
                          user_agent,
                          expires_at
                        ) VALUES (
                          %s,
                          %s,
                          %s,
                          %s,
                          DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL %s MINUTE)
                        )
                        """,
                        (
                            reset_code_hash(user["id"], reset_code),
                            user["id"],
                            (ip_address or "")[:80],
                            (user_agent or "")[:255],
                            self._reset_token_minutes(),
                        ),
                    )

                connection.commit()
            except Exception:
                connection.rollback()
                raise

        if reset_code and not send_password_reset_email(self.config, email, reset_code):
            print("Password reset email was not delivered. Check SMTP configuration.")

        return response

    def confirm_password_reset(self, payload):
        email = normalize_email(payload.get("email"))
        code = normalize_reset_code(payload.get("code") or payload.get("token") or payload.get("resetToken"))
        password = str(payload.get("password") or "")

        validate_email(email)

        if not code:
            raise AuthError("Reset code must contain 6 digits")

        validate_password(password)
        password_salt, password_hash = hash_password(password)

        with connect(self.config) as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                          t.id_hash,
                          t.attempts,
                          u.id,
                          u.email,
                          u.display_name,
                          u.base_currency
                        FROM password_reset_tokens t
                        JOIN users u ON u.id = t.user_id
                        WHERE u.email = %s
                          AND t.used_at IS NULL
                          AND t.expires_at > CURRENT_TIMESTAMP(3)
                          AND u.email IS NOT NULL
                        ORDER BY t.created_at DESC
                        LIMIT 1
                        """,
                        (email,),
                    )
                    user = cursor.fetchone()

                    if not user:
                        raise AuthError("Reset code is expired or invalid", status_code=400)

                    if int(user.get("attempts") or 0) >= RESET_CONFIRM_ATTEMPT_LIMIT:
                        raise AuthError("Reset code is expired or invalid", status_code=400)

                    expected_hash = reset_code_hash(user["id"], code)

                    if not hmac.compare_digest(expected_hash, user["id_hash"]):
                        cursor.execute(
                            """
                            UPDATE password_reset_tokens
                            SET attempts = attempts + 1
                            WHERE id_hash = %s
                            """,
                            (user["id_hash"],),
                        )
                        connection.commit()
                        raise AuthError("Reset code is expired or invalid", status_code=400)

                    cursor.execute(
                        """
                        UPDATE users
                        SET password_hash = %s,
                            password_salt = %s
                        WHERE id = %s
                        """,
                        (password_hash, password_salt, user["id"]),
                    )
                    cursor.execute(
                        """
                        UPDATE password_reset_tokens
                        SET used_at = CURRENT_TIMESTAMP(3)
                        WHERE id_hash = %s
                        """,
                        (user["id_hash"],),
                    )
                    cursor.execute("DELETE FROM user_sessions WHERE user_id = %s", (user["id"],))

                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return {
            "ok": True,
            "message": "Password was updated. Sign in with your new password.",
        }

    def reset_password(self, payload):
        return self.confirm_password_reset(payload)

    def create_session(self, user_id: str, user_agent: str | None, ip_address: str | None):
        token = secrets.token_urlsafe(36)
        token_hash = hash_session_token(token)
        expires_at = datetime.utcnow() + timedelta(days=SESSION_DAYS)

        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO user_sessions (
                      id_hash,
                      user_id,
                      user_agent,
                      ip_address,
                      expires_at
                    ) VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        token_hash,
                        user_id,
                        (user_agent or "")[:255],
                        (ip_address or "")[:80],
                        expires_at.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
                    ),
                )
            connection.commit()

        return token

    def current_user(self, token: str | None):
        if not token:
            return None

        token_hash = hash_session_token(token)

        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT u.id, u.email, u.display_name, u.base_currency
                    FROM user_sessions s
                    JOIN users u ON u.id = s.user_id
                    WHERE s.id_hash = %s
                      AND s.expires_at > CURRENT_TIMESTAMP(3)
                      AND u.email IS NOT NULL
                    """,
                    (token_hash,),
                )
                user = cursor.fetchone()

                if not user:
                    return None

                cursor.execute(
                    """
                    UPDATE user_sessions
                    SET last_seen_at = CURRENT_TIMESTAMP(3)
                    WHERE id_hash = %s
                    """,
                    (token_hash,),
                )
            connection.commit()

        return self._user_payload(user)

    def logout(self, token: str | None) -> None:
        if not token:
            return

        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM user_sessions WHERE id_hash = %s", (hash_session_token(token),))
            connection.commit()

    def prune_expired_sessions(self) -> None:
        with connect(self.config) as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM user_sessions WHERE expires_at <= CURRENT_TIMESTAMP(3)")
                cursor.execute(
                    """
                    DELETE FROM password_reset_tokens
                    WHERE expires_at <= CURRENT_TIMESTAMP(3)
                       OR used_at IS NOT NULL
                    """
                )
            connection.commit()

    def _reset_token_minutes(self) -> int:
        minutes = int(getattr(self.config, "password_reset_token_minutes", RESET_TOKEN_MINUTES_FALLBACK))
        return min(max(minutes, 5), 240)

    def _create_initial_portfolio(self, cursor, user_id: str, real_accounts_before: int) -> None:
        if real_accounts_before == 0 and legacy_default_portfolio_has_data(cursor):
            cursor.execute(
                """
                UPDATE portfolios
                SET user_id = %s,
                    name = %s,
                    updated_at = CURRENT_TIMESTAMP(3)
                WHERE id = %s
                """,
                (user_id, "Main Portfolio", DEFAULT_PORTFOLIO_ID),
            )
            return

        cursor.execute(
            """
            INSERT INTO portfolios (id, user_id, name, base_currency, reporting_currency)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (f"portfolio-{uuid.uuid4().hex}", user_id, "Main Portfolio", "USD", "ILS"),
        )

    def _user_payload(self, user):
        return {
            "id": user["id"],
            "email": user["email"],
            "displayName": user["display_name"],
            "baseCurrency": user.get("base_currency", "USD"),
        }


def legacy_default_portfolio_has_data(cursor) -> bool:
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM portfolio_positions
        WHERE portfolio_id = %s
        """,
        (DEFAULT_PORTFOLIO_ID,),
    )
    return int(cursor.fetchone()["count"]) > 0


def normalize_email(value) -> str:
    return str(value or "").strip().lower()


def validate_email(email: str) -> None:
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise AuthError("צריך להזין אימייל תקין")


def validate_password(password: str) -> None:
    if len(password) < 8:
        raise AuthError("הסיסמה חייבת להכיל לפחות 8 תווים")


def hash_password(password: str):
    salt = secrets.token_bytes(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return (
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(password_hash).decode("ascii"),
    )


def verify_password(password: str, salt: str | None, expected_hash: str | None) -> bool:
    if not salt or not expected_hash:
        return False

    try:
        salt_bytes = base64.b64decode(salt.encode("ascii"))
        expected = base64.b64decode(expected_hash.encode("ascii"))
    except Exception:
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_bytes,
        PBKDF2_ITERATIONS,
    )
    return hmac.compare_digest(actual, expected)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_reset_code() -> str:
    return f"{secrets.randbelow(10 ** RESET_CODE_DIGITS):0{RESET_CODE_DIGITS}d}"


def normalize_reset_code(value) -> str | None:
    code = re.sub(r"\D", "", str(value or ""))
    return code if len(code) == RESET_CODE_DIGITS else None


def reset_code_hash(user_id: str, code: str) -> str:
    return hash_reset_token(f"{user_id}:{code}")


def send_password_reset_email(config: AppConfig, email: str, code: str) -> bool:
    if not config.smtp_host:
        return False

    sender = config.smtp_from or config.smtp_user

    if not sender:
        return False

    message = EmailMessage()
    message["Subject"] = "Portfolio Live password reset"
    message["From"] = sender
    message["To"] = email
    message.set_content(
        "\n".join(
            [
                "Use this one-time 6-digit reset code in Portfolio Live:",
                "",
                code,
                "",
                f"It expires in {config.password_reset_token_minutes} minutes.",
                f"Open Portfolio Live: {config.app_base_url}",
                "If you did not request this, ignore this email.",
            ]
        )
    )

    try:
        smtp_class = smtplib.SMTP_SSL if config.smtp_ssl else smtplib.SMTP

        with smtp_class(config.smtp_host, config.smtp_port, timeout=12) as smtp:
            if config.smtp_tls and not config.smtp_ssl:
                smtp.starttls()

            if config.smtp_user:
                smtp.login(config.smtp_user, smtp_login_password(config))

            smtp.send_message(message)
        return True
    except Exception as error:
        print(f"Password reset email failed: {error}")
        return False


def smtp_login_password(config: AppConfig) -> str:
    if config.smtp_host.lower().endswith("gmail.com"):
        return config.smtp_password.replace(" ", "")

    return config.smtp_password
