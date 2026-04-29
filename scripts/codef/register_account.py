"""
신한은행 계정을 CODEF에 1회성으로 등록하고 connectedId를 발급받는다.

발급된 connectedId는 .env의 SHINHAN_CONNECTED_ID에 붙여넣은 후
fetch_shinhan.py를 매번 호출하면 된다 (재인증 불필요, 영구 사용).
"""

from __future__ import annotations

import getpass
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from easycodefpy import (
    Codef,
    ServiceType,
    encrypt_rsa,
    KEY_RESULT,
    KEY_CODE,
    KEY_EXTRA_MESSAGE,
    KEY_DATA,
    KEY_CONNECTED_ID,
)

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")


def service_type_from_env() -> ServiceType:
    return {
        "PRODUCT": ServiceType.PRODUCT,
        "DEMO": ServiceType.DEMO,
        "SANDBOX": ServiceType.SANDBOX,
    }[os.environ.get("CODEF_SERVICE_TYPE", "DEMO").upper()]


def main() -> None:
    public_key = os.environ["CODEF_PUBLIC_KEY"]
    org_code = os.environ.get("SHINHAN_ORG_CODE", "0088")

    login_id = os.environ.get("SHINHAN_LOGIN_ID") or input("신한은행 인터넷뱅킹 ID: ").strip()
    login_pw = os.environ.get("SHINHAN_LOGIN_PW") or getpass.getpass("신한은행 인터넷뱅킹 PW: ")

    codef = Codef()
    codef.public_key = public_key
    codef.set_demo_client_info(
        os.environ["CODEF_DEMO_CLIENT_ID"],
        os.environ["CODEF_DEMO_CLIENT_SECRET"],
    )
    if os.environ.get("CODEF_CLIENT_ID"):
        codef.set_client_info(
            os.environ["CODEF_CLIENT_ID"],
            os.environ["CODEF_CLIENT_SECRET"],
        )

    account_payload = {
        "accountList": [
            {
                "countryCode": "KR",
                "businessType": "BK",
                "clientType": "P",
                "organization": org_code,
                "loginType": "1",
                "id": login_id,
                "password": encrypt_rsa(login_pw, public_key),
            }
        ]
    }

    res = codef.create_account(service_type_from_env(), account_payload)
    parsed = json.loads(res) if isinstance(res, str) else res

    result = parsed.get(KEY_RESULT, {})
    print(f"\n[CODEF] code={result.get(KEY_CODE)} message={result.get(KEY_EXTRA_MESSAGE)}")

    data = parsed.get(KEY_DATA, {})
    cid = data.get(KEY_CONNECTED_ID)
    if not cid:
        print("\n[FAIL] connectedId 발급 실패. 응답 전체:")
        print(json.dumps(parsed, ensure_ascii=False, indent=2))
        raise SystemExit(1)

    print(f"\n[OK] connectedId: {cid}")
    print("\n다음 단계:")
    print(f"  1) .env 파일을 열어 SHINHAN_CONNECTED_ID={cid} 로 설정")
    print(f"  2) python {ROOT / 'fetch_shinhan.py'} 실행")


if __name__ == "__main__":
    main()
