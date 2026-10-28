import json
import secrets
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from velov_session_store import HELPER, KeychainSessionStore


HELPER.chmod(0o700)
service = "fr.velov.personal-api.storage-test." + str(uuid.uuid4())
store = KeychainSessionStore(service)
tokens = {"access_token": secrets.token_urlsafe(32), "refresh_token": secrets.token_urlsafe(32), "id_token": secrets.token_urlsafe(32), "expires_in": 1800, "refresh_expires_in": 86400}
child_code = "import json,sys; from velov_session_store import KeychainSessionStore; s=KeychainSessionStore(sys.argv[1]).load(); print(json.dumps({'available':s is not None,'access_token':s['tokens']['access_token'] if s else None}))"
try:
    assert store.load() is None, "A new session must be absent."
    store.save("test@example.invalid", tokens, "https://issuer.example.invalid", "test-client", datetime.now(timezone.utc).timestamp())
    child = subprocess.run([sys.executable, "-c", child_code, service], cwd=Path(__file__).resolve().parent, capture_output=True, timeout=50, check=True)
    observed = json.loads(child.stdout)
    assert observed["available"] and observed["access_token"] == tokens["access_token"], "A new process must recover the saved session."
    tokens["refresh_token"] = secrets.token_urlsafe(32)
    store.save("test@example.invalid", tokens, "https://issuer.example.invalid", "test-client", datetime.now(timezone.utc).timestamp())
    assert store.load()["tokens"]["refresh_token"] == tokens["refresh_token"], "Renewal must replace the previous refresh token."
finally:
    store.clear()
assert store.load() is None, "Deleting the session must remove access for later processes."
print(json.dumps({"keychain_storage": "passed", "new_process_reuse": "passed", "token_replacement": "passed", "deletion": "passed", "real_account_used": False}))
