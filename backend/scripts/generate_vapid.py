"""Generate a VAPID keypair for Web Push and append it to backend/.env.

py_vapid exposes cryptography objects rather than PEM strings in this version,
so serialise them explicitly. The private key never leaves the local machine
except into the gitignored backend/.env.
"""

import base64
import pathlib
import sys

from py_vapid import Vapid

ENV_PATH = pathlib.Path(r"A:\Projects\meridian\backend\.env")


def main() -> int:
    vapid = Vapid()
    vapid.generate_keys()

    private_pem = vapid.private_pem()
    public_pem = vapid.public_pem()

    # A PEM contains newlines, which dotenv cannot represent in a single value
    # and pydantic-settings rejects as an unknown extra field. Store both keys
    # base64-encoded on one line and decode them in Settings.
    private_b64 = base64.b64encode(private_pem).decode()
    public_b64 = base64.b64encode(public_pem).decode()

    lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    lines = [ln for ln in lines if not ln.startswith("MERIDIAN_WEB_PUSH_")]
    while lines and not lines[-1].strip():
        lines.pop()

    lines += [
        "",
        "# Web Push (VAPID), base64-encoded PEM. Regenerate with: python scripts/generate_vapid.py",
        f"MERIDIAN_WEB_PUSH_PUBLIC_KEY={public_b64}",
        f"MERIDIAN_WEB_PUSH_PRIVATE_KEY={private_b64}",
        "MERIDIAN_WEB_PUSH_SUBJECT=mailto:meridian@example.com",
    ]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # The browser needs the uncompressed point, base64url encoded.
    from cryptography.hazmat.primitives import serialization

    raw_point = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    raw = base64.urlsafe_b64encode(raw_point).rstrip(b"=").decode()
    print("wrote base64-encoded VAPID keypair to backend/.env")
    print(f"frontend applicationServerKey ({len(raw)} chars): {raw[:24]}...")
    return 0


if __name__ == "__main__":
    sys.exit(main())