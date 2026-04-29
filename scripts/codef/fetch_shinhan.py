"""
신한은행 거래내역을 CODEF로 가져와 finanz의 신한 JSON 포맷으로 저장.

저장 위치: data/transactions/shinhan/{from}_{to}_{account_tail}.json
저장된 JSON은 기존 import-transactions.js가 그대로 처리한다.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from easycodefpy import (
    Codef,
    ServiceType,
    KEY_RESULT,
    KEY_CODE,
    KEY_EXTRA_MESSAGE,
    KEY_DATA,
)

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent.parent
OUT_DIR = REPO_ROOT / "data" / "transactions" / "shinhan"
KST = timezone(timedelta(hours=9))

load_dotenv(ROOT / ".env")


def service_type_from_env() -> ServiceType:
    return {
        "PRODUCT": ServiceType.PRODUCT,
        "DEMO": ServiceType.DEMO,
        "SANDBOX": ServiceType.SANDBOX,
    }[os.environ.get("CODEF_SERVICE_TYPE", "DEMO").upper()]


def build_codef() -> Codef:
    codef = Codef()
    codef.public_key = os.environ["CODEF_PUBLIC_KEY"]
    codef.set_demo_client_info(
        os.environ["CODEF_DEMO_CLIENT_ID"],
        os.environ["CODEF_DEMO_CLIENT_SECRET"],
    )
    if os.environ.get("CODEF_CLIENT_ID"):
        codef.set_client_info(
            os.environ["CODEF_CLIENT_ID"],
            os.environ["CODEF_CLIENT_SECRET"],
        )
    return codef


def fetch_transactions(
    codef: Codef,
    connected_id: str,
    org_code: str,
    account: str,
    start: date,
    end: date,
) -> list[dict]:
    """CODEF /v1/kr/bank/p/account/transaction-list 호출.

    응답 스키마는 CODEF 공식 문서 기준. resTrHistoryList의 각 항목을
    그대로 반환 (변환은 호출 측 책임).
    """
    parameter = {
        "connectedId": connected_id,
        "organization": org_code,
        "account": account,
        "startDate": start.strftime("%Y%m%d"),
        "endDate": end.strftime("%Y%m%d"),
        "orderBy": "0",  # 0=ASC, 1=DESC
    }
    res = codef.request_product(
        "/v1/kr/bank/p/account/transaction-list",
        service_type_from_env(),
        parameter,
    )
    parsed = json.loads(res) if isinstance(res, str) else res

    result = parsed.get(KEY_RESULT, {})
    code = result.get(KEY_CODE)
    if code != "CF-00000":
        raise RuntimeError(
            f"CODEF error code={code} message={result.get(KEY_EXTRA_MESSAGE)} "
            f"raw={json.dumps(parsed, ensure_ascii=False)[:500]}"
        )

    data = parsed.get(KEY_DATA) or {}
    return data.get("resTrHistoryList") or []


def to_finanz_record(idx: int, item: dict) -> dict:
    """CODEF 거래 1건을 finanz 신한 JSON 포맷의 한 record로 변환."""
    tr_date = item.get("resAccountTrDate", "")  # YYYYMMDD
    tr_time = item.get("resAccountTrTime", "000000")  # HHMMSS

    iso_local = (
        f"{tr_date[0:4]}-{tr_date[4:6]}-{tr_date[6:8]}"
        f"T{tr_time[0:2]}:{tr_time[2:4]}:{tr_time[4:6]}+09:00"
    )
    dt_kst = datetime.fromisoformat(iso_local)
    iso_utc = dt_kst.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    out_amt = float(item.get("resAccountOut") or 0)
    in_amt = float(item.get("resAccountIn") or 0)
    if out_amt > 0:
        amount = -out_amt
        tx_type = "출금"
    else:
        amount = in_amt
        tx_type = "입금"

    description = (
        item.get("resAccountDesc3")
        or item.get("resAccountDesc1")
        or item.get("resAccountDesc2")
        or item.get("resAccountDesc4")
        or ""
    ).strip()

    institution = (item.get("resAccountDesc4") or item.get("resAccountDesc2") or "").strip()
    balance = float(item.get("resAfterTranBalance") or 0)

    return {
        "id": f"txn-{idx}",
        "occurredAt": {"iso": iso_local, "utc": iso_utc},
        "description": description,
        "transactionType": tx_type,
        "institution": institution,
        "counterAccount": "",
        "amount": amount,
        "balance": balance,
        "memo": "",
        "raw": item,
    }


def write_finanz_json(account: str, start: date, end: date, records: list[dict]) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tail = account[-6:]
    out_path = OUT_DIR / f"{start.isoformat()}_{end.isoformat()}_{tail}.json"

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceFile": f"codef:shinhan:{account}:{start.isoformat()}_{end.isoformat()}",
        "timezone": "+09:00",
        "account": {"bank": "신한은행", "holder": "", "number": account},
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "total": len(records),
        "currency": "KRW",
        "records": records,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="신한은행 거래내역 CODEF 수집")
    today = date.today()
    p.add_argument("--from", dest="start", default=(today - timedelta(days=30)).isoformat())
    p.add_argument("--to", dest="end", default=today.isoformat())
    p.add_argument(
        "--account",
        action="append",
        help="조회할 계좌번호 (여러 개 지정 가능). 미지정 시 .env의 SHINHAN_ACCOUNTS",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)

    accounts = args.account or [
        a.strip() for a in os.environ.get("SHINHAN_ACCOUNTS", "").split(",") if a.strip()
    ]
    if not accounts:
        raise SystemExit("계좌가 없음. --account 또는 SHINHAN_ACCOUNTS 환경변수 지정 필요")

    connected_id = os.environ["SHINHAN_CONNECTED_ID"]
    org_code = os.environ.get("SHINHAN_ORG_CODE", "0088")
    codef = build_codef()

    for account in accounts:
        print(f"[fetch] {account} {start} ~ {end}")
        items = fetch_transactions(codef, connected_id, org_code, account, start, end)
        records = [to_finanz_record(i + 1, it) for i, it in enumerate(items)]
        path = write_finanz_json(account, start, end, records)
        print(f"  -> {len(records)} records, saved: {path.relative_to(REPO_ROOT)}")

    print("\n다음: node scripts/import-transactions.js  (DB 적재)")


if __name__ == "__main__":
    main()
