import fcntl
import json
import os
import subprocess
from contextlib import contextmanager
from pathlib import Path


PRIVATE_DIR = Path.home() / ".t3/userdata/velov-local-client"
HELPER = PRIVATE_DIR / "keychain-helper"
SERVICE = "fr.velov.personal-api.session.v1"
TOKEN_FIELDS = {"access_token", "refresh_token", "id_token", "expires_in", "refresh_expires_in", "token_type", "scope"}


class SessionStoreError(RuntimeError):
    pass


class KeychainSessionStore:
    def __init__(self, service=SERVICE):
        if not service.startswith("fr.velov.personal-api."):
            raise SessionStoreError("invalid_service")
        self.service = service

    @contextmanager
    def locked(self):
        PRIVATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor = os.open(PRIVATE_DIR / "session.lock", os.O_CREAT | os.O_RDWR, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def _call(self, operation, payload=None):
        if not HELPER.is_file():
            raise SessionStoreError("keychain_helper_not_built")
        try:
            result = subprocess.run([str(HELPER), operation, self.service], input=payload, capture_output=True, timeout=45, check=False)
        except subprocess.TimeoutExpired:
            raise SessionStoreError("keychain_authorization_timed_out") from None
        if result.returncode == 44:
            return None
        if result.returncode != 0:
            raise SessionStoreError("keychain_access_failed_" + str(result.returncode))
        return result.stdout

    def load(self):
        data = self._call("get")
        if data is None:
            return None
        try:
            payload = json.loads(data)
        except (ValueError, TypeError):
            raise SessionStoreError("invalid_session_record") from None
        self._validate(payload)
        return payload

    def save(self, email, tokens, issuer, client_id, saved_at):
        payload = {"schema": 1, "issuer": issuer, "client_id": client_id, "account_email": email, "saved_at": saved_at, "tokens": {key: value for key, value in tokens.items() if key in TOKEN_FIELDS}}
        self._validate(payload)
        self._call("put", json.dumps(payload).encode())

    def clear(self):
        self._call("delete")

    @staticmethod
    def _validate(payload):
        if not isinstance(payload, dict) or set(payload) != {"schema", "issuer", "client_id", "account_email", "saved_at", "tokens"} or payload["schema"] != 1:
            raise SessionStoreError("invalid_session_record")
        tokens = payload["tokens"]
        if not isinstance(tokens, dict) or not set(tokens).issubset(TOKEN_FIELDS):
            raise SessionStoreError("invalid_session_tokens")
        for key in ["access_token", "refresh_token", "id_token"]:
            if not isinstance(tokens.get(key), str) or not tokens[key]:
                raise SessionStoreError("incomplete_session_tokens")
        if not isinstance(payload["saved_at"], (int, float)) or not isinstance(tokens.get("expires_in"), (int, float)):
            raise SessionStoreError("invalid_session_expiry")
        if not isinstance(payload["account_email"], str) or "@" not in payload["account_email"]:
            raise SessionStoreError("invalid_session_account")
