"""Libère UN vélo Vélo'v avec la session du Trousseau. Un seul essai, aucune boucle.

Sans --go : n'envoie rien, affiche seulement la requête prévue.
Usage : python3 velov_release.py STATION BORNE VELO [--go]   (BORNE=0 : retrouvée via /bikes)
"""
import argparse
import json
import time
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, build_opener

from velov_connected import refresh_session, session_status
from velov_session_store import KeychainSessionStore, SessionStoreError
from verify_personal_account import API, CLIENT_ID, REALM, SafeRedirect, fetch
from cyclocity_config import PUBLIC_CLIENT

# The WAF answers 403 to script user agents (Python-urllib, node) on /bikes and friends.
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"}


def post_trip(opener, url, auth, body):
    request = Request(url, data=json.dumps(body).encode(), method="POST", headers={
        **auth, **UA, "Accept-Language": "fr",
        "Accept": "application/vnd.trip.v6+json",
        "Content-Type": "application/vnd.trip.v6+json",
    })
    try:
        response = opener.open(request, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.read().decode(errors="replace")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("station", type=int)
    parser.add_argument("stand", type=int)
    parser.add_argument("bike", type=int)
    parser.add_argument("--go", action="store_true", help="envoie vraiment la libération")
    args = parser.parse_args()
    body = {"stationNumber": args.station, "standNumber": args.stand, "bikeNumber": args.bike, "typeFrom": "SMARTPHONE"}
    if not args.go:
        return {"dry_run": True, "would_post": "/contracts/lyon/accounts/{accountId}/subscriptions/{subscriptionId}/trips", "body": body}

    out = {"at": datetime.now(timezone.utc).isoformat(), "body": body}
    store = KeychainSessionStore()
    with store.locked():
        session = store.load()
        if session is None:
            return {"success": False, "reason": "initial_login_required"}
        if session["issuer"] != REALM or session["client_id"] != CLIENT_ID:
            return {"success": False, "reason": "stored_session_configuration_mismatch"}
        opener = build_opener(SafeRedirect())
        if session_status(session)["access_token_remaining_seconds"] < 120:
            session = refresh_session(opener, store, session)
        status, text, _ = fetch(opener, API + "/auth/environments/PRD/client_tokens", headers=UA, json_body=PUBLIC_CLIENT)
        if status != 200:
            return {**out, "success": False, "stage": "application_token", "status": status}
        auth = {**UA, "Authorization": "Taknv1 " + json.loads(text)["accessToken"], "Identity": session["tokens"]["access_token"]}
        status, text, _ = fetch(opener, API + "/contracts/lyon/accounts/" + quote(session["account_email"], safe="") + "/id", headers={**auth, "Accept": "application/json"})
        if status != 200:
            return {**out, "success": False, "stage": "account_id", "status": status}
        account_url = API + "/contracts/lyon/accounts/" + json.loads(text)
        status, text, _ = fetch(opener, account_url + "/subscriptions?periods=CURRENT&typeList=ST&typeList=LT&isLocked=false", headers={**auth, "Accept": "application/vnd.subscription.v6+json"})
        subs = json.loads(text) if status == 200 else []
        if not subs:
            return {**out, "success": False, "stage": "subscription", "status": status, "count": 0}
        if args.stand == 0:
            status, text, _ = fetch(opener, API + "/contracts/lyon/bikes?stationNumber=" + str(args.station), headers={**auth, "Accept": "application/vnd.bikes.v4+json"})
            match = [b for b in (json.loads(text) if status == 200 else []) if b.get("number") == args.bike]
            if not match:
                return {**out, "success": False, "stage": "bike_lookup", "status": status, "reason": "bike_not_at_station"}
            body["standNumber"] = match[0]["standNumber"]
            out["body"] = body
        sub = subs[0]
        out["subscription_type"] = sub.get("type")
        status, text = post_trip(opener, account_url + "/subscriptions/" + sub["id"] + "/trips", auth, body)
        out["release_status"] = status
        try:
            data = json.loads(text)
            out["release_response"] = {k: data[k] for k in ("transactionState", "code", "message", "error", "errorCode") if k in data}
        except ValueError:
            out["release_response_raw"] = text[:300]
        time.sleep(0)
        status, text, _ = fetch(opener, account_url + "/trips/ongoing", headers={**auth, "Accept": "application/vnd.trip.v6+json"})
        out["ongoing_status"] = status
        if status == 200:
            data = json.loads(text)
            out["ongoing_trip"] = bool(data) if not isinstance(data, list) else len(data) > 0
        out["success"] = out.get("release_response", {}).get("transactionState") == "OK"
        return out


if __name__ == "__main__":
    try:
        result = main()
    except SessionStoreError as error:
        result = {"success": False, "reason": str(error)}
    except Exception as error:
        result = {"success": False, "failure_type": type(error).__name__, "detail": str(error)[:200]}
    print(json.dumps(result, ensure_ascii=False))
