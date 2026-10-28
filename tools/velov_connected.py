import argparse
import json
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import build_opener

from velov_session_store import KeychainSessionStore, SessionStoreError
from verify_personal_account import CLIENT_ID, OIDC, REALM, SafeRedirect, fetch, read_account, run


def session_status(session):
    now = datetime.now(timezone.utc).timestamp()
    tokens = session["tokens"]
    return {"session_saved_to_keychain": True, "access_token_remaining_seconds": max(0, int(session["saved_at"] + tokens["expires_in"] - now)), "refresh_token_remaining_seconds": max(0, int(session["saved_at"] + tokens["refresh_expires_in"] - now)) if isinstance(tokens.get("refresh_expires_in"), (int, float)) else None, "password_saved": False}


def refresh_session(opener, store, session):
    status, body, headers = fetch(opener, OIDC + "/token", fields={"grant_type": "refresh_token", "client_id": CLIENT_ID, "refresh_token": session["tokens"]["refresh_token"]})
    if status != 200:
        reason = "refresh_failed"
        try:
            error_code = json.loads(body).get("error")
        except (ValueError, TypeError):
            error_code = None
        if error_code == "invalid_grant":
            store.clear()
            reason = "session_expired_or_revoked_login_required"
        raise SessionStoreError(reason + "_http_" + str(status))
    response = json.loads(body)
    if not isinstance(response.get("access_token"), str) or not response["access_token"] or not isinstance(response.get("expires_in"), (int, float)) or response["expires_in"] <= 0:
        raise SessionStoreError("invalid_refresh_response")
    tokens = {**session["tokens"], **response}
    if "refresh_expires_in" not in response and isinstance(session["tokens"].get("refresh_expires_in"), (int, float)):
        tokens["refresh_expires_in"] = max(0, session["saved_at"] + session["tokens"]["refresh_expires_in"] - datetime.now(timezone.utc).timestamp())
    store.save(session["account_email"], tokens, REALM, CLIENT_ID, datetime.now(timezone.utc).timestamp())
    return store.load()


def command(arguments):
    store = KeychainSessionStore()
    with store.locked():
        session = store.load()
        if arguments.action == "login":
            if session is not None:
                return {"reason": "session_already_saved_use_check", **session_status(session)}
            return run(arguments.secret_file, session_store=store)
        if session is None:
            return {"session_saved_to_keychain": False, "reason": "initial_login_required"}
        if session["issuer"] != REALM or session["client_id"] != CLIENT_ID:
            raise SessionStoreError("stored_session_configuration_mismatch")
        if arguments.action == "status":
            return session_status(session)
        opener = build_opener(SafeRedirect())
        if arguments.action == "logout":
            logout_url = OIDC + "/logout?" + urlencode({"id_token_hint": session["tokens"]["id_token"], "post_logout_redirect_uri": "https://velov.grandlyon.com/openid_connect_logout", "state": secrets.token_urlsafe(16)})
            try:
                status, body, headers = fetch(opener, logout_url)
            finally:
                store.clear()
            return {"session_saved_to_keychain": False, "session_cleanup_status": status}
        refreshed = False
        if arguments.action == "refresh" or session_status(session)["access_token_remaining_seconds"] < 60:
            session = refresh_session(opener, store, session)
            refreshed = True
        result = {"checked_at": datetime.now(timezone.utc).isoformat(), "used_saved_session": True, "refreshed_without_credentials": refreshed, **session_status(session)}
        read_account(opener, session["account_email"], session["tokens"], result, names={"rewards"}, read_bikes=False)
        needs_refresh = result.get("account_resolution_status") == 401 or result.get("reads", {}).get("rewards", {}).get("status") == 401
        if needs_refresh and not refreshed:
            session = refresh_session(opener, store, session)
            result = {"checked_at": datetime.now(timezone.utc).isoformat(), "used_saved_session": True, "refreshed_without_credentials": True, **session_status(session)}
            read_account(opener, session["account_email"], session["tokens"], result, names={"rewards"}, read_bikes=False)
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Session personnelle Vélo'v conservée dans le Trousseau macOS. Aucune réservation ni libération.")
    subcommands = parser.add_subparsers(dest="action", required=True)
    login = subcommands.add_parser("login")
    login.add_argument("secret_file", help="Fichier privé fourni par la carte de secrets T3")
    for action in ["status", "check", "refresh", "logout"]:
        subcommands.add_parser(action)
    arguments = parser.parse_args()
    try:
        result = command(arguments)
    except SessionStoreError as error:
        result = {"success": False, "reason": str(error), "secret_values_logged": False}
    except Exception as error:
        result = {"success": False, "failure_type": type(error).__name__, "secret_values_logged": False}
    print(json.dumps(result, ensure_ascii=False))
