"""
현대카드/신한카드 승인내역(사용내역)을 CODEF로 가져와 finanz JSON 포맷으로 저장.

승인내역 = 결제 발생 시점의 거래. 사용자가 보통 "카드 사용내역"이라 부르는 것.
청구내역(billing)은 월말 청구서 기준이라 시점이 다름 — 필요하면 --kind billing.

저장: data/transactions/{shinhancard|hyundaicard}/{from}_{to}.json
기존 import-transactions.js가 그대로 처리.
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
KST = timezone(timedelta(hours=9))

load_dotenv(ROOT / ".env")

# (display_name, env_org_key, default_org_code, output_dir_name, record_id_prefix)
CARDS = {
    "hyundai": ("현대카드", "HYUNDAICARD_ORG_CODE", "0302", "hyundaicard", "card"),
    "shinhan": ("신한카드", "SHINHANCARD_ORG_CODE", "0306", "shinhancard", "shinhancard"),
}


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


APPROVAL_PATH = "/v1/kr/card/p/account/approval-list"
BILLING_PATH = "/v1/kr/card/p/account/billing-list"


def fetch_card(
    codef: Codef,
    connected_id: str,
    org_code: str,
    start: date,
    end: date,
    kind: str,
) -> list[dict]:
    parameter = {
        "connectedId": connected_id,
        "organization": org_code,
        "startDate": start.strftime("%Y%m%d"),
        "endDate": end.strftime("%Y%m%d"),
        "orderBy": "0",
        "inquiryType": "1",  # 1=일별, 0=월별 (승인내역)
    }
    path = APPROVAL_PATH if kind == "approval" else BILLING_PATH
    res = codef.request_product(path, service_type_from_env(), parameter)
    parsed = json.loads(res) if isinstance(res, str) else res

    result = parsed.get(KEY_RESULT, {})
    code = result.get(KEY_CODE)
    if code != "CF-00000":
        raise RuntimeError(
            f"CODEF error code={code} message={result.get(KEY_EXTRA_MESSAGE)} "
            f"raw={json.dumps(parsed, ensure_ascii=False)[:500]}"
        )

    data = parsed.get(KEY_DATA) or {}
    if kind == "approval":
        return data.get("resApprovalList") or data.get("resCardApprovalList") or []
    return data.get("resBillingList") or data.get("resCardBillingList") or []


def to_finanz_record(idx: int, item: dict, prefix: str, bank_label: str) -> dict:
    used_date = item.get("resUsedDate", "")  # YYYYMMDD
    used_time = item.get("resUsedTime") or "000000"

    iso_local = (
        f"{used_date[0:4]}-{used_date[4:6]}-{used_date[6:8]}"
        f"T{used_time[0:2]}:{used_time[2:4]}:{used_time[4:6]}+09:00"
    )
    dt_kst = datetime.fromisoformat(iso_local)
    iso_utc = dt_kst.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    used_amount = float(item.get("resUsedAmount") or 0)
    cancel_status = item.get("resCancelStatus") or item.get("resCancelYN") or "0"
    sign = -1 if cancel_status not in ("1", "Y") else 1
    amount = sign * used_amount

    description = (
        item.get("resMemberStoreName")
        or item.get("resMemberStore")
        or item.get("resMemberStoreNumber")
        or ""
    ).strip()

    payment_type = (item.get("resPaymentType") or "카드결제").strip()
    card_name = (item.get("resCardName") or "").strip()
    card_no = (item.get("resCardNo") or "").strip()

    metadata: dict = {}
    for src_key, dst_key in [
        ("resInstallmentMonth", "installmentMonth"),
        ("resApprovalNo", "approvalNo"),
        ("resMemberStoreType", "memberStoreType"),
        ("resMemberStoreNumber", "memberStoreNumber"),
    ]:
        if item.get(src_key):
            metadata[dst_key] = item[src_key]

    record = {
        "id": f"{prefix}-{idx}",
        "occurredAt": {"iso": iso_local, "utc": iso_utc},
        "description": description,
        "transactionType": payment_type,
        "institution": bank_label,
        "counterAccount": card_no,
        "amount": amount,
        "balance": None,
        "memo": card_name,
        "raw": item,
    }
    if metadata:
        record["metadata"] = metadata
    return record


def write_finanz_json(
    out_dirname: str,
    bank_label: str,
    start: date,
    end: date,
    records: list[dict],
    kind: str,
) -> Path:
    out_dir = REPO_ROOT / "data" / "transactions" / out_dirname
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{start.isoformat()}_{end.isoformat()}.json"

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceFile": f"codef:{out_dirname}:{kind}:{start.isoformat()}_{end.isoformat()}",
        "timezone": "+09:00",
        "account": {"bank": bank_label, "holder": "", "number": ""},
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "total": len(records),
        "currency": "KRW",
        "records": records,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="카드 승인/청구내역 CODEF 수집")
    today = date.today()
    p.add_argument("--from", dest="start", default=(today - timedelta(days=30)).isoformat())
    p.add_argument("--to", dest="end", default=today.isoformat())
    p.add_argument(
        "--card",
        action="append",
        choices=list(CARDS.keys()),
        help="카드 선택 (반복 가능). 미지정 시 전체",
    )
    p.add_argument(
        "--kind",
        choices=["approval", "billing"],
        default="approval",
        help="approval=승인내역(사용내역), billing=청구내역",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    selected = args.card or list(CARDS.keys())

    connected_id = os.environ["CARD_CONNECTED_ID"]
    codef = build_codef()

    for key in selected:
        bank_label, env_key, default_org, out_dir, prefix = CARDS[key]
        org_code = os.environ.get(env_key, default_org)
        print(f"[fetch] {bank_label} ({args.kind}) {start} ~ {end}")
        items = fetch_card(codef, connected_id, org_code, start, end, args.kind)
        records = [to_finanz_record(i + 1, it, prefix, bank_label) for i, it in enumerate(items)]
        path = write_finanz_json(out_dir, bank_label, start, end, records, args.kind)
        print(f"  -> {len(records)} records, saved: {path.relative_to(REPO_ROOT)}")

    print("\n다음: node scripts/import-transactions.js  (DB 적재)")


if __name__ == "__main__":
    main()
