from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import base64

from app.core.config import settings


# --- Password hashing (simple sha256-based for environments without bcrypt C ext) ---

def hash_password(password: str) -> str:
    import secrets
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${h.hex()}"


def verify_password(plain: str, hashed: str) -> bool:
    try:
        salt, h = hashed.split("$", 1)
        expected = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 100_000)
        return hmac.compare_digest(expected.hex(), h)
    except Exception:
        return False


# --- JWT (minimal implementation using stdlib) ---

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    s += "=" * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)


def create_access_token(subject: int, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url_encode(json.dumps({"sub": str(subject), "exp": int(expire.timestamp())}).encode())
    sig_input = f"{header}.{payload}".encode()
    sig = hmac.new(settings.SECRET_KEY.encode(), sig_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64url_encode(sig)}"


def decode_access_token(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid token")
    header, payload, sig = parts
    expected_sig = hmac.new(
        settings.SECRET_KEY.encode(), f"{header}.{payload}".encode(), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(_b64url_decode(sig), expected_sig):
        raise ValueError("Invalid signature")
    data = json.loads(_b64url_decode(payload))
    if data.get("exp", 0) < datetime.now(timezone.utc).timestamp():
        raise ValueError("Token expired")
    return data
