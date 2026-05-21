#!/usr/bin/env python3
"""
bruce-wealth-os 거래 데이터 → Odoo Bank Statement 마이그레이션

Usage:
    python migrate-to-odoo.py --dry-run   # 매핑 확인만
    python migrate-to-odoo.py             # 실제 마이그레이션
"""

import argparse
import json
import glob
import sys
import xmlrpc.client
from datetime import datetime
from collections import defaultdict

# ─── Odoo 접속 정보 ───
ODOO_URL = "https://odoo.intellieffect.com"
ODOO_DB = "intellieffect"
ODOO_USER = "bruce@intellieffect.com"
ODOO_API_KEY = "873c1dcf8df39b03ad497b04e094ce68f35da23a"
COMPANY_ID = 3

DATA_DIR = "/Volumes/WorkSSD/Projects/bruce-wealth-os/data/transactions"

# ─── Journal 매핑 ───
CHANNEL_JOURNAL = {
    "tossbank": 17,
    "hyundaicard": 20,
    "shinhancard": 21,
    "kakaopay": 22,
    "naverpay": 23,
    "coupang": 24,
}

# shinhan은 계좌번호로 분리
SHINHAN_JOURNALS = {
    "091082": 18,  # SH01 개인
    "270351": 19,  # SH02 사업
}

# 카드 채널: 양수 = 지출 → Odoo에서는 음수로 변환 필요
NEGATE_CHANNELS = {"hyundaicard", "shinhancard"}

BATCH_SIZE = 100


def connect_odoo():
    """Odoo XML-RPC 연결 및 uid 반환"""
    common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_API_KEY, {})
    if not uid:
        raise Exception("Odoo 인증 실패")
    models = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")
    print(f"✅ Odoo 연결 성공 (uid={uid})")
    return uid, models


def load_transactions():
    """모든 채널의 거래 데이터를 로드하여 (channel_label, journal_id, records) 리스트 반환"""
    results = []

    for channel_dir in sorted(glob.glob(f"{DATA_DIR}/*/")):
        channel = channel_dir.rstrip("/").split("/")[-1]

        for json_file in sorted(glob.glob(f"{channel_dir}*.json")):
            with open(json_file) as f:
                data = json.load(f)

            account = data.get("account", {})
            records = data.get("records", [])
            account_number = account.get("number", "")

            if channel == "shinhan":
                # 계좌번호로 journal 결정
                journal_id = None
                for key, jid in SHINHAN_JOURNALS.items():
                    if key in account_number:
                        journal_id = jid
                        break
                if journal_id is None:
                    print(f"⚠️  shinhan 계좌번호 매핑 실패: {account_number} ({json_file})")
                    continue
                label = f"shinhan-{[k for k in SHINHAN_JOURNALS if k in account_number][0]}"
            else:
                journal_id = CHANNEL_JOURNAL.get(channel)
                if journal_id is None:
                    print(f"⚠️  채널 매핑 없음: {channel}")
                    continue
                label = channel

            results.append((label, journal_id, channel, records, json_file))

    return results


def parse_record(record, channel):
    """거래 레코드를 Odoo statement line 값으로 변환"""
    # 날짜
    occurred = record.get("occurredAt", {})
    iso = occurred.get("iso", "")
    if iso:
        dt = datetime.fromisoformat(iso)
        date_str = dt.strftime("%Y-%m-%d")
    else:
        return None

    # 적요
    description = record.get("description", "")
    tx_type = record.get("transactionType", "")
    payment_ref = f"{description}" if description else tx_type
    if not payment_ref:
        payment_ref = f"거래-{record.get('id', 'unknown')}"

    # 금액
    amount = record.get("amount", 0)
    if amount is None:
        return None

    # 카드 채널: 부호 반전 (양수 지출 → 음수)
    if channel in NEGATE_CHANNELS:
        amount = -amount

    return {
        "date": date_str,
        "payment_ref": payment_ref,
        "amount": amount,
    }


def get_existing_lines(uid, models, journal_id):
    """해당 journal의 기존 statement line을 조회하여 중복 체크용 set 반환"""
    ctx = {"allowed_company_ids": [COMPANY_ID]}
    existing = models.execute_kw(
        ODOO_DB, uid, ODOO_API_KEY,
        "account.bank.statement.line", "search_read",
        [[["journal_id", "=", journal_id], ["company_id", "=", COMPANY_ID]]],
        {"fields": ["date", "payment_ref", "amount"], "limit": 0, "context": ctx},
    )
    result = set()
    for line in existing:
        date_val = line["date"]
        ref = line.get("payment_ref") or ""
        amt = float(line["amount"])
        result.add((date_val, ref, amt))
    return result


def migrate(dry_run=False):
    """메인 마이그레이션 로직"""
    all_data = load_transactions()

    # 통계
    stats = defaultdict(lambda: {"total": 0, "created": 0, "skipped": 0, "errors": 0})
    error_log = []

    if not dry_run:
        uid, models = connect_odoo()
    else:
        uid, models = None, None
        print("🔍 DRY-RUN 모드 — 실제 생성하지 않음\n")

    for label, journal_id, channel, records, json_file in all_data:
        print(f"\n{'='*60}")
        print(f"📂 {label} (journal_id={journal_id}) — {len(records)}건")
        print(f"   파일: {json_file}")

        # 기존 데이터 조회 (중복 방지)
        existing = set()
        if not dry_run:
            try:
                existing = get_existing_lines(uid, models, journal_id)
                print(f"   기존 {len(existing)}건 존재")
            except Exception as e:
                print(f"   ⚠️  기존 데이터 조회 실패: {e}")

        # 레코드 변환
        lines_to_create = []
        for record in records:
            stats[label]["total"] += 1
            parsed = parse_record(record, channel)
            if parsed is None:
                stats[label]["errors"] += 1
                error_log.append(f"[{label}] 파싱 실패: {record.get('id', '?')}")
                continue

            # 중복 체크
            dup_key = (parsed["date"], parsed["payment_ref"], parsed["amount"])
            if dup_key in existing:
                stats[label]["skipped"] += 1
                continue

            lines_to_create.append({
                "date": parsed["date"],
                "payment_ref": parsed["payment_ref"],
                "amount": parsed["amount"],
                "journal_id": journal_id,
                "company_id": COMPANY_ID,
            })
            existing.add(dup_key)  # prevent within-batch duplicates too

        if dry_run:
            print(f"   → 생성 대상: {len(lines_to_create)}건, "
                  f"중복 스킵: {stats[label]['skipped']}건, "
                  f"파싱 에러: {stats[label]['errors']}건")
            if lines_to_create:
                sample = lines_to_create[0]
                print(f"   샘플: {sample}")
            stats[label]["created"] += len(lines_to_create)
            continue

        # 배치 생성
        for i in range(0, len(lines_to_create), BATCH_SIZE):
            batch = lines_to_create[i:i + BATCH_SIZE]
            try:
                ctx = {"allowed_company_ids": [COMPANY_ID]}
                ids = models.execute_kw(
                    ODOO_DB, uid, ODOO_API_KEY,
                    "account.bank.statement.line", "create",
                    [batch],
                    {"context": ctx},
                )
                stats[label]["created"] += len(ids)
                print(f"   ✅ 배치 {i//BATCH_SIZE + 1}: {len(ids)}건 생성")
            except Exception as e:
                stats[label]["errors"] += len(batch)
                error_msg = f"[{label}] 배치 {i//BATCH_SIZE + 1} 실패: {e}"
                error_log.append(error_msg)
                print(f"   ❌ {error_msg}")

    # ─── 결과 보고 ───
    print(f"\n{'='*60}")
    print("📊 마이그레이션 결과")
    print(f"{'='*60}")

    total_all = sum(s["total"] for s in stats.values())
    created_all = sum(s["created"] for s in stats.values())
    skipped_all = sum(s["skipped"] for s in stats.values())
    errors_all = sum(s["errors"] for s in stats.values())

    print(f"{'채널':<20} {'전체':>8} {'생성':>8} {'스킵':>8} {'에러':>8}")
    print("-" * 56)
    for label in sorted(stats.keys()):
        s = stats[label]
        print(f"{label:<20} {s['total']:>8} {s['created']:>8} {s['skipped']:>8} {s['errors']:>8}")
    print("-" * 56)
    print(f"{'합계':<20} {total_all:>8} {created_all:>8} {skipped_all:>8} {errors_all:>8}")

    if error_log:
        print(f"\n⚠️  에러 로그 ({len(error_log)}건):")
        for err in error_log:
            print(f"  - {err}")

    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="bruce-wealth-os → Odoo Bank Statement 마이그레이션")
    parser.add_argument("--dry-run", action="store_true", help="실제 생성 없이 매핑만 확인")
    args = parser.parse_args()

    migrate(dry_run=args.dry_run)
