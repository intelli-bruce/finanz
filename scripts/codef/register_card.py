"""
현대카드 + 신한카드를 CODEF에 1회성으로 등록하고 connectedId를 발급받는다.

CODEF는 한 connectedId에 여러 기관(카드/은행/페이) 통합 등록 가능.
이 스크립트는 두 카드를 동시 등록 → 단일 connectedId 반환.

발급된 connectedId는 .env의 CARD_CONNECTED_ID에 붙여넣은 후
fetch_card.py를 매번 호출하면 된다 (재인증 불필요, 영구 사용).
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


def prompt_card(label: str, env_id_key: str, env_pw_key: str, public_key: str) -> tuple[str, str]:
    cid = os.environ.get(env_id_key) or input(f"{label} 홈페이지 로그인 ID: ").strip()
    pw = os.environ.get(env_pw_key) or getpass.getpass(f"{label} 홈페이지 로그인 PW: ")
    return cid, encrypt_rsa(pw, public_key)


def main() -> None:
    public_key = os.environ["CODEF_PUBLIC_KEY"]

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

    print("== 현대카드 ==")
    hc_id, hc_pw = prompt_card(
        "현대카드", "HYUNDAICARD_LOGIN_ID", "HYUNDAICARD_LOGIN_PW", public_key
    )
    print("\n== 신한카드 ==")
    sc_id, sc_pw = prompt_card(
        "신한카드", "SHINHANCARD_LOGIN_ID", "SHINHANCARD_LOGIN_PW", public_key
    )

    payload = {
        "accountList": [
            {
                "countryCode": "KR",
                "businessType": "CD",  # CD = Card
                "clientType": "P",
                "organization": os.environ.get("HYUNDAICARD_ORG_CODE", "0302"),
                "loginType": "1",
                "id": hc_id,
                "password": hc_pw,
            },
            {
                "countryCode": "KR",
                "businessType": "CD",
                "clientType": "P",
                "organization": os.environ.get("SHINHANCARD_ORG_CODE", "0306"),
                "loginType": "1",
                "id": sc_id,
                "password": sc_pw,
            },
        ]
    }

    res = codef.create_account(service_type_from_env(), payload)
    parsed = json.loads(res) if isinstance(res, str) else res

    result = parsed.get(KEY_RESULT, {})
    print(f"\n[CODEF] code={result.get(KEY_CODE)} message={result.get(KEY_EXTRA_MESSAGE)}")

    data = parsed.get(KEY_DATA, {})
    cid = data.get(KEY_CONNECTED_ID)

    if data.get("resRegisterAccountList") or data.get("resFailedAccountList"):
        print("\n등록 결과:")
        for item in data.get("resRegisterAccountList", []) or []:
            print(f"  ✓ org={item.get('organization')} status={item.get('registerStatus')}")
        for item in data.get("resFailedAccountList", []) or []:
            print(f"  ✗ org={item.get('organization')} reason={item.get('reason')}")

    if not cid:
        print("\n[FAIL] connectedId 발급 실패. 응답 전체:")
        print(json.dumps(parsed, ensure_ascii=False, indent=2))
        raise SystemExit(1)

    print(f"\n[OK] connectedId: {cid}")
    print("\n다음 단계:")
    print(f"  1) .env 파일에 CARD_CONNECTED_ID={cid} 설정")
    print(f"  2) python {ROOT / 'fetch_card.py'} 실행")


if __name__ == "__main__":
    main()
