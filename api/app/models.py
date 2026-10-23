"""Persistent SQLite/Postgres model layer with encrypted private profile fields."""

import base64
import hashlib
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from secrets import token_urlsafe

import psycopg
from cryptography.fernet import Fernet
from psycopg.rows import dict_row

PRIVATE_FIELDS = ("phone", "tax_id", "residence_address", "city", "region", "postal_code")
USER_FIELDS = (
    "id", "email", "password", "email_verified", "verification_token_hash", "verification_expires_at",
    "full_name", *PRIVATE_FIELDS, "business_name", "country", "timezone", "terms_accepted",
    "privacy_accepted", "plan", "api_key",
)
INVOICE_FIELDS = (
    "id", "user_id", "client_name", "client_email", "amount_cents", "due_date", "status",
    "pings_sent", "last_ping_at", "invoice_number",
)


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "sqlite:///pingfox.db")
    if not url.startswith(("sqlite:///", "postgresql://", "postgres://")):
        raise RuntimeError("DATABASE_URL must use sqlite:/// or postgresql://")
    return url


def _cipher() -> Fernet:
    secret = os.environ.get("PINGFOX_SECRET_KEY", "dev-only-change-me").encode()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret).digest()))


def _as_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


@dataclass
class User:
    id: int
    email: str
    password: str
    email_verified: bool = False
    verification_token_hash: str = ""
    verification_expires_at: datetime | None = None
    full_name: str = ""
    phone: str = ""
    business_name: str = ""
    tax_id: str = ""
    residence_address: str = ""
    city: str = ""
    region: str = ""
    postal_code: str = ""
    country: str = ""
    timezone: str = "UTC"
    terms_accepted: bool = False
    privacy_accepted: bool = False
    plan: str = "free"
    api_key: str = field(default_factory=lambda: token_urlsafe(32))


@dataclass
class Invoice:
    id: int
    user_id: int
    client_name: str
    client_email: str
    amount_cents: int
    due_date: datetime
    status: str = "pending"
    pings_sent: int = 0
    last_ping_at: datetime | None = None
    invoice_number: str = ""


class Repository:
    """SQLite-backed repository; sensitive profile columns are encrypted at rest."""

    def __init__(self, path: str | None = None) -> None:
        self.url = path or _database_url()
        self.is_postgres = self.url.startswith(("postgresql://", "postgres://"))
        self.path = self.url.removeprefix("sqlite:///") if not self.is_postgres else self.url
        if not self.is_postgres and self.path != ":memory:":
            Path(self.path).expanduser().parent.mkdir(parents=True, exist_ok=True)
        self._fernet = _cipher()
        self.users: dict[int, User] = {}
        self.invoices: dict[int, Invoice] = {}
        self.sessions: dict[str, int] = {}
        self.user_columns: set[str] = set()
        self.invoice_columns: set[str] = set()
        self.session_columns: set[str] = set()
        self._initialize()
        self._load()

    def _connect(self):
        if self.is_postgres:
            return psycopg.connect(self.url, row_factory=dict_row)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _execute(self, connection, sql: str, params=()):
        if self.is_postgres:
            sql = sql.replace("?", "%s")
        return connection.execute(sql, params)

    def _initialize(self) -> None:
        with self._connect() as connection:
            schema = """
                CREATE TABLE IF NOT EXISTS users (
                    id {id_type} PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
                    email_verified {bool_type} NOT NULL DEFAULT {false_value}, verification_token_hash TEXT NOT NULL DEFAULT '', verification_expires_at {time_type},
                    full_name TEXT NOT NULL, phone TEXT NOT NULL, business_name TEXT NOT NULL,
                    tax_id TEXT NOT NULL, residence_address TEXT NOT NULL, city TEXT NOT NULL,
                    region TEXT NOT NULL, postal_code TEXT NOT NULL, country TEXT NOT NULL,
                    timezone TEXT NOT NULL, terms_accepted {bool_type} NOT NULL, privacy_accepted {bool_type} NOT NULL,
                    plan TEXT NOT NULL, api_key TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS invoices (
                    id {id_type} PRIMARY KEY, user_id INTEGER NOT NULL, client_name TEXT NOT NULL,
                    client_email TEXT NOT NULL, amount_cents INTEGER NOT NULL, due_date TEXT NOT NULL,
                    status TEXT NOT NULL, pings_sent INTEGER NOT NULL, last_ping_at TEXT, invoice_number TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL);
            """.format(
                id_type="SERIAL" if self.is_postgres else "INTEGER",
                bool_type="BOOLEAN" if self.is_postgres else "INTEGER",
                false_value="FALSE" if self.is_postgres else "0",
                time_type="TIMESTAMPTZ" if self.is_postgres else "TEXT",
            )
            if self.is_postgres:
                self._execute(connection, schema)
                columns = {row["column_name"] for row in self._execute(connection, "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users'")}
            else:
                connection.executescript(schema)
                columns = {row["name"] for row in self._execute(connection, "PRAGMA table_info(users)")}
            migrations = {
                "email_verified": f"ALTER TABLE users ADD COLUMN email_verified {'BOOLEAN' if self.is_postgres else 'INTEGER'} NOT NULL DEFAULT {'FALSE' if self.is_postgres else '0'}",
                "verification_token_hash": "ALTER TABLE users ADD COLUMN verification_token_hash TEXT NOT NULL DEFAULT ''",
                "verification_expires_at": f"ALTER TABLE users ADD COLUMN verification_expires_at {'TIMESTAMPTZ' if self.is_postgres else 'TEXT'}",
            }
            for column, statement in migrations.items():
                if column not in columns:
                    self._execute(connection, statement)
            if "password" not in columns and "password_hash" not in columns:
                self._execute(connection, "ALTER TABLE users ADD COLUMN password TEXT NOT NULL DEFAULT ''")
            for column, definition in {
                "full_name": "TEXT NOT NULL DEFAULT ''",
                "phone": "TEXT NOT NULL DEFAULT ''",
                "tax_id": "TEXT NOT NULL DEFAULT ''",
                "residence_address": "TEXT NOT NULL DEFAULT ''",
                "city": "TEXT NOT NULL DEFAULT ''",
                "region": "TEXT NOT NULL DEFAULT ''",
                "postal_code": "TEXT NOT NULL DEFAULT ''",
                "country": "TEXT NOT NULL DEFAULT ''",
                "timezone": "TEXT NOT NULL DEFAULT 'UTC'",
                "terms_accepted": ("BOOLEAN" if self.is_postgres else "INTEGER") + " NOT NULL DEFAULT " + ("FALSE" if self.is_postgres else "0"),
                "privacy_accepted": ("BOOLEAN" if self.is_postgres else "INTEGER") + " NOT NULL DEFAULT " + ("FALSE" if self.is_postgres else "0"),
                "plan": "TEXT NOT NULL DEFAULT 'free'",
            }.items():
                if column not in columns:
                    self._execute(connection, f"ALTER TABLE users ADD COLUMN {column} {definition}")
            self._refresh_columns(connection)

    def _refresh_columns(self, connection) -> None:
        if self.is_postgres:
            query = "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name IN ('users', 'invoices', 'sessions')"
            rows = self._execute(connection, query)
            grouped = {}
            for row in rows:
                grouped.setdefault(row["table_name"], set()).add(row["column_name"])
            self.user_columns = grouped.get("users", set())
            self.invoice_columns = grouped.get("invoices", set())
            self.session_columns = grouped.get("sessions", set())
        else:
            self.user_columns = {row["name"] for row in self._execute(connection, "PRAGMA table_info(users)")}
            self.invoice_columns = {row["name"] for row in self._execute(connection, "PRAGMA table_info(invoices)")}
            self.session_columns = {row["name"] for row in self._execute(connection, "PRAGMA table_info(sessions)")}

    def _encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode()

    def _decrypt(self, value: str) -> str:
        if not value:
            return ""
        return self._fernet.decrypt(value.encode()).decode()

    def _load(self) -> None:
        with self._connect() as connection:
            for row in self._execute(connection, "SELECT * FROM users"):
                row_keys = row.keys()
                values = {name: row[name] for name in USER_FIELDS if name in row_keys}
                if "password" not in values:
                    values["password"] = row["password_hash"] if "password_hash" in row_keys else ""
                for name in PRIVATE_FIELDS:
                    values[name] = self._decrypt(values.get(name, ""))
                values["email_verified"] = bool(values["email_verified"])
                values["verification_expires_at"] = _as_datetime(values["verification_expires_at"])
                values["terms_accepted"] = bool(values["terms_accepted"])
                values["privacy_accepted"] = bool(values["privacy_accepted"])
                self.users[row["id"]] = User(**values)
            for row in self._execute(connection, "SELECT * FROM invoices"):
                row_keys = row.keys()
                values = {name: row[name] for name in INVOICE_FIELDS if name in row_keys}
                values["due_date"] = _as_datetime(values["due_date"])
                values["last_ping_at"] = _as_datetime(values["last_ping_at"])
                self.invoices[row["id"]] = Invoice(**values)
            for row in self._execute(connection, "SELECT token, user_id FROM sessions"):
                self.sessions[row["token"]] = row["user_id"]

    def _next_id(self, table: str) -> int:
        with self._connect() as connection:
            row = self._execute(connection, f"SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM {table}").fetchone()
        return int(row["next_id"])

    def create_user(self, email: str, password: str, **profile: object) -> User:
        if self.get_user_by_email(email):
            raise ValueError("email already exists")
        user = User(self._next_id("users"), email, password, **profile)
        password_column = "password" if "password" in self.user_columns else "password_hash"
        columns = ["id", "email", password_column, "email_verified", "verification_token_hash", "verification_expires_at", "full_name", *PRIVATE_FIELDS, "business_name", "country", "timezone", "terms_accepted", "privacy_accepted", "plan", "api_key"]
        values = [user.password if column == "password_hash" else getattr(user, column) for column in columns]
        for index, column in enumerate(columns):
            if column in PRIVATE_FIELDS:
                values[index] = self._encrypt(values[index])
        if user.verification_expires_at:
            values[columns.index("verification_expires_at")] = user.verification_expires_at.isoformat()
        with self._connect() as connection:
            self._execute(connection, f"INSERT INTO users ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", values)
        self.users[user.id] = user
        return user

    def get_user_by_email(self, email: str) -> User | None:
        return next((user for user in self.users.values() if user.email == email), None)

    def get_user_by_verification_hash(self, token_hash: str) -> User | None:
        return next((user for user in self.users.values() if user.verification_token_hash == token_hash), None)

    def get_user_by_api_key(self, api_key: str) -> User | None:
        return next((user for user in self.users.values() if user.api_key == api_key), None)

    def get_user(self, user_id: int) -> User | None:
        return self.users.get(user_id)

    def save_user(self, user: User) -> None:
        columns = ["email_verified", "verification_token_hash", "verification_expires_at", "full_name", *PRIVATE_FIELDS, "business_name", "country", "timezone"]
        values = [getattr(user, column) for column in columns]
        for index, column in enumerate(columns):
            if column in PRIVATE_FIELDS:
                values[index] = self._encrypt(values[index])
        if user.verification_expires_at:
            values[columns.index("verification_expires_at")] = user.verification_expires_at.isoformat()
        values.append(user.id)
        with self._connect() as connection:
            self._execute(connection, f"UPDATE users SET {','.join(f'{column} = ?' for column in columns)} WHERE id = ?", values)

    def create_session(self, user_id: int) -> str:
        token = token_urlsafe(32)
        with self._connect() as connection:
            self._execute(connection, "INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        self.sessions[token] = user_id
        return token

    def delete_session(self, token: str) -> None:
        with self._connect() as connection:
            self._execute(connection, "DELETE FROM sessions WHERE token = ?", (token,))
        self.sessions.pop(token, None)

    def user_for_session(self, token: str) -> User | None:
        user_id = self.sessions.get(token)
        return self.get_user(user_id) if user_id else None

    def invoices_for(self, user_id: int) -> list[Invoice]:
        return [invoice for invoice in self.invoices.values() if invoice.user_id == user_id]

    def create_invoice(self, invoice: Invoice) -> Invoice:
        invoice.id = self._next_id("invoices")
        with self._connect() as connection:
            self._execute(connection, "INSERT INTO invoices (id,user_id,client_name,client_email,amount_cents,due_date,status,pings_sent,last_ping_at,invoice_number) VALUES (?,?,?,?,?,?,?,?,?,?)", (invoice.id, invoice.user_id, invoice.client_name, invoice.client_email, invoice.amount_cents, invoice.due_date.isoformat(), invoice.status, invoice.pings_sent, None, invoice.invoice_number))
        self.invoices[invoice.id] = invoice
        return invoice

    def save_invoice(self, invoice: Invoice) -> None:
        with self._connect() as connection:
            self._execute(connection, "UPDATE invoices SET status = ?, pings_sent = ?, last_ping_at = ? WHERE id = ?", (invoice.status, invoice.pings_sent, invoice.last_ping_at.isoformat() if invoice.last_ping_at else None, invoice.id))

    def reset(self) -> None:
        with self._connect() as connection:
            if self.is_postgres:
                self._execute(connection, "DELETE FROM sessions")
                self._execute(connection, "DELETE FROM invoices")
                self._execute(connection, "DELETE FROM users")
            else:
                connection.executescript("DELETE FROM sessions; DELETE FROM invoices; DELETE FROM users;")
        self.users.clear()
        self.invoices.clear()
        self.sessions.clear()


repository = Repository()
