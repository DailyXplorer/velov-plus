import base64
import hashlib
import http.cookiejar
import json
import os
import re
import secrets
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener

from cyclocity_config import PUBLIC_CLIENT


IAM = "https://iam.cyclocity.fr"
REALM = IAM + "/realms/vls-default"
OIDC = REALM + "/protocol/openid-connect"
API = "https://api.cyclocity.fr"
CALLBACK = "https://velov.grandlyon.com/openid_connect_login"
CLIENT_ID = "vls-ios-lyon"


@dataclass
class Form:
    identifier: str
    action: str
    fields: dict = field(default_factory=dict)


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.forms = []
        self.current = None
        self.text = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form":
            self.current = Form(attrs.get("id", ""), attrs.get("action", ""))
            self.forms.append(self.current)
        elif tag == "input" and self.current is not None:
            if attrs.get("name") and attrs.get("type", "text") == "hidden":
                self.current.fields[attrs["name"]] = attrs.get("value", "")

    def handle_endtag(self, tag):
        if tag == "form":
            self.current = None

    def handle_data(self, data):
        self.text.append(data)


class CallbackReached(Exception):
    def __init__(self, url):
        self.url = url


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        target = urlsplit(new_url)
        expected = urlsplit(CALLBACK)
        if (target.scheme, target.netloc, target.path) == (expected.scheme, expected.netloc, expected.path):
            raise CallbackReached(new_url)
        if target.scheme != "https" or target.netloc != "iam.cyclocity.fr":
            return None
        return super().redirect_request(request, response, code, message, headers, new_url)


def fetch(opener, url, fields=None, headers=None, json_body=None):
    target = urlsplit(url)
    if target.scheme != "https" or target.netloc not in {"iam.cyclocity.fr", "api.cyclocity.fr"}:
        raise RuntimeError("Unexpected network destination")
    request_headers = {"Accept-Language": "fr", **(headers or {})}
    body = None
    if fields is not None:
        body = urlencode(fields).encode()
        request_headers["Content-Type"] = "application/x-www-form-urlencoded"
    if json_body is not None:
        body = json.dumps(json_body).encode()
        request_headers["Content-Type"] = "application/json"
    request = Request(url, data=body, headers=request_headers)
    try:
        response = opener.open(request, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.read().decode(errors="replace"), response.headers


def page_failure(status, text):
    content = " ".join(Page(text).text).casefold()
    if "autre appareil" in content or "another device" in content:
        return {"status": status, "reason": "account_in_use_on_another_device"}
    if "identifiants invalides" in content or "invalid username or password" in content or "incorrect" in content:
        return {"status": status, "reason": "credentials_not_accepted"}
    return {"status": status, "reason": "unexpected_login_step", "form_ids": [form.identifier for form in Page(text).forms]}


def read_account(opener, email, tokens, result, names=None, read_bikes=True):
    status, body, headers = fetch(opener, API + "/auth/environments/PRD/client_tokens", json_body=PUBLIC_CLIENT)
    if status != 200:
        result["failure"] = {"stage": "application_token", "status": status}
        return result
    app_token = json.loads(body)["accessToken"]
    auth = {"Authorization": "Taknv1 " + app_token, "Identity": tokens["access_token"]}
    status, body, headers = fetch(opener, API + "/contracts/lyon/accounts/" + quote(email, safe="") + "/id", headers={**auth, "Accept": "application/json"})
    result["account_resolution_status"] = status
    if status != 200:
        return result
    account_id = json.loads(body)
    if not isinstance(account_id, str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', account_id):
        raise RuntimeError("Unexpected account identifier shape")
    account_url = API + "/contracts/lyon/accounts/" + account_id
    probes = [
        ("profile", "", "application/vnd.account.v4+json"),
        ("rewards", "/rewards", "application/vnd.rewards.v5+json"),
        ("subscriptions", "/subscriptions?periods=CURRENT&typeList=ST&typeList=LT&isLocked=false", "application/vnd.subscription.v6+json"),
        ("trips_ongoing", "/trips/ongoing", "application/vnd.trip.v6+json"),
        ("trips_history", "/trips?status=FINISHED&status=ERROR&status=REVERSED", "application/vnd.trip.v6+json"),
        ("bookings", "/bookings", "application/json"),
        ("payment", "/payment", "application/vnd.payment.v3+json"),
    ]
    result["reads"] = {}
    for name, suffix, accept in probes:
        if names is not None and name not in names:
            continue
        status, body, headers = fetch(opener, account_url + suffix, headers={**auth, "Accept": accept})
        record = {"status": status}
        if status == 200:
            data = json.loads(body)
            if name == "profile":
                record.update({key: data[key] for key in ["isLocked", "completion"] if key in data})
            elif name == "rewards":
                record.update({key: data[key] for key in ["balance", "autoSpend", "total", "friendsInvitedCount"] if key in data})
            elif name == "payment":
                record["payment_valid"] = data.get("paymentValid")
            elif isinstance(data, list):
                record["count"] = len(data)
                if name == "subscriptions":
                    record["types"] = sorted({item.get("type", "UNKNOWN") for item in data})
        result["reads"][name] = record
    if read_bikes:
        status, body, headers = fetch(opener, API + "/contracts/lyon/bikes?stationNumber=2002", headers={**auth, "Accept": "application/vnd.bikes.v4+json"})
        result["authenticated_bikes_read"] = {"status": status, "content_type": headers.get("Content-Type")}
    return result


def run(secret_path, session_store=None):
    result = {"checked_at": datetime.now(timezone.utc).isoformat(), "authenticated": False, "scope": "One sign-in attempt, account GET requests only, no booking, release or payment action."}
    secret_file = Path(secret_path)
    raw = secret_file.read_text().strip()
    secret_file.unlink()
    emails = re.findall(r'[^\s<>:";,]+@[^\s<>";,]+\.[^\s<>";,]+', raw)
    code_input = raw
    for candidate in emails:
        code_input = code_input.replace(candidate, "")
    codes = re.findall(r'(?<!\d)\d{6}(?!\d)', code_input)
    if len(emails) != 1 or len(codes) != 1:
        result["failure"] = {"reason": "credential_input_needs_one_email_and_one_six_digit_velov_code", "email_found": len(emails) == 1, "six_digit_code_found": len(codes) == 1}
        return result
    email, password = emails[0].strip(), codes[0]
    del raw, code_input, emails, codes
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    cookie_jar = http.cookiejar.CookieJar()
    opener = build_opener(HTTPCookieProcessor(cookie_jar), SafeRedirect())
    authorize_url = OIDC + "/auth?" + urlencode({"client_id": CLIENT_ID, "response_type": "code", "scope": "openid email", "ui_locales": "fr", "redirect_uri": CALLBACK, "code_challenge": challenge, "code_challenge_method": "S256", "state": state, "nonce": nonce})
    status, text, headers = fetch(opener, authorize_url)
    forms = [form for form in Page(text).forms if form.identifier == "kc-form-login"]
    if status != 200 or len(forms) != 1:
        result["failure"] = {"stage": "login_page", **page_failure(status, text)}
        return result
    login_form = forms[0]
    login_fields = {**login_form.fields, "username": email, "password": password, "credentialId": ""}
    tokens = None
    session_saved = False
    try:
        try:
            status, text, headers = fetch(opener, urljoin(authorize_url, login_form.action), fields=login_fields)
            del password, login_fields
            if status != 200:
                result["failure"] = {"stage": "credentials_submission", **page_failure(status, text)}
                return result
            forms = [form for form in Page(text).forms if form.identifier == "vls-form-device-id"]
            if len(forms) != 1:
                result["failure"] = {"stage": "credentials_submission", **page_failure(status, text)}
                return result
            device_form = forms[0]
            private_dir = Path.home() / ".t3/userdata/velov-local-client"
            private_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            device_file = private_dir / "device-id"
            if not device_file.exists():
                descriptor = os.open(device_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(descriptor, "w") as handle:
                    handle.write(str(uuid.uuid4()))
            device_fields = {**device_form.fields, "device_id": device_file.read_text().strip()}
            status, text, headers = fetch(opener, urljoin(authorize_url, device_form.action), fields=device_fields)
            result["failure"] = {"stage": "device_submission", **page_failure(status, text)}
            return result
        except CallbackReached as callback:
            query = parse_qs(urlsplit(callback.url).query)
            if query.get("state") != [state] or "error" in query or len(query.get("code", [])) != 1:
                result["failure"] = {"stage": "authorization_callback", "reason": "invalid_state_or_authorization_error"}
                return result
            code = query["code"][0]
        status, body, headers = fetch(opener, OIDC + "/token", fields={"grant_type": "authorization_code", "client_id": CLIENT_ID, "redirect_uri": CALLBACK, "code": code, "code_verifier": verifier})
        if status != 200:
            result["failure"] = {"stage": "token_exchange", "status": status}
            return result
        tokens = json.loads(body)
        id_part = tokens["id_token"].split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(id_part + "=" * (-len(id_part) % 4)))
        audience = claims.get("aud")
        if claims.get("iss") != REALM or claims.get("nonce") != nonce or claims.get("exp", 0) <= datetime.now(timezone.utc).timestamp() or not (audience == CLIENT_ID or isinstance(audience, list) and CLIENT_ID in audience):
            result["failure"] = {"stage": "token_claims", "reason": "unexpected_issuer_audience_nonce_or_expiry"}
            return result
        result["authenticated"] = True
        result["access_token_expires_in_seconds"] = tokens.get("expires_in")
        result["refresh_token_expires_in_seconds"] = tokens.get("refresh_expires_in")
        if session_store is not None:
            session_store.save(email, tokens, REALM, CLIENT_ID, datetime.now(timezone.utc).timestamp())
            session_saved = True
            result["session_saved_to_keychain"] = True
        return read_account(opener, email, tokens, result)
    finally:
        if not session_saved and tokens is not None and tokens.get("id_token"):
            logout_url = OIDC + "/logout?" + urlencode({"id_token_hint": tokens["id_token"], "post_logout_redirect_uri": "https://velov.grandlyon.com/openid_connect_logout", "state": secrets.token_urlsafe(16)})
            try:
                status, body, headers = fetch(opener, logout_url)
                result["session_cleanup_status"] = status
            except Exception as error:
                result["session_cleanup_error_type"] = type(error).__name__
        cookie_jar.clear()


if __name__ == "__main__":
    try:
        report = run(sys.argv[1])
    except Exception as error:
        report = {"authenticated": False, "failure_type": type(error).__name__, "secret_values_logged": False}
    print(json.dumps(report, ensure_ascii=False))
