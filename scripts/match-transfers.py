#!/usr/bin/env python3
"""
계좌간 이체 자동 매칭 (finanz DB)

휴리스틱: 동일 절대값 + 다른 채널 + 시각 ±24시간 + 본인이체 키워드.
1:1 가장 가까운 시각 페어를 1순위로 잡고, 양쪽 거래에 동일 match_id (UUID) +
counter_channel_id 교차 세팅. 이미 match_id 가진 거래는 건드리지 않음 (idempotent).

Usage:
    python scripts/match-transfers.py --dry-run         # 후보 미리보기
    python scripts/match-transfers.py                   # 실제 적용
    python scripts/match-transfers.py --since 2026-04   # 특정 기간
"""

import argparse
import re
import sys
import uuid
from datetime import datetime
from collections import defaultdict

import psycopg2
import psycopg2.extras

DSN = "dbname=postgres"
SELF_KEYWORDS = re.compile(
    r"최종혁|토뱅|토스증권|토스페이|카카오페이|네이버페이|카드대금|오픈뱅킹"
)
WINDOW_SEC = 24 * 3600


def fetch_candidates(cur, since=None):
    sql = """
        SELECT id, channel_id, occurred_at, description, amount
        FROM transactions
        WHERE match_id IS NULL
          AND amount IS NOT NULL
          AND amount <> 0
          {since_clause}
        ORDER BY occurred_at
    """.format(since_clause=("AND occurred_at >= %s" if since else ""))
    cur.execute(sql, (since,) if since else ())
    return cur.fetchall()


def is_self(desc: str) -> bool:
    return bool(desc and SELF_KEYWORDS.search(desc))


def match_pairs(rows):
    """
    절대값별 bucket → (출금, 입금) 페어 중 시각 ±24h, 다른 채널, 양쪽 self 키워드.
    각 거래는 1번만 매칭. 시각 차이 작은 페어 우선.
    """
    by_abs = defaultdict(list)
    for r in rows:
        by_abs[abs(r["amount"])].append(r)

    candidates = []  # (gap_sec, out_row, in_row)
    for amt, group in by_abs.items():
        if amt == 0 or len(group) < 2:
            continue
        outs = [r for r in group if r["amount"] < 0 and is_self(r["description"])]
        ins = [r for r in group if r["amount"] > 0 and is_self(r["description"])]
        for o in outs:
            for i in ins:
                if o["channel_id"] == i["channel_id"]:
                    continue
                gap = abs((i["occurred_at"] - o["occurred_at"]).total_seconds())
                if gap > WINDOW_SEC:
                    continue
                candidates.append((gap, o, i))

    candidates.sort(key=lambda c: c[0])
    used = set()
    pairs = []
    for gap, o, i in candidates:
        if o["id"] in used or i["id"] in used:
            continue
        used.add(o["id"])
        used.add(i["id"])
        pairs.append((o, i, gap))
    return pairs


def apply_pairs(cur, pairs):
    for o, i, _gap in pairs:
        match_id = str(uuid.uuid4())
        cur.execute(
            """
            UPDATE transactions
               SET match_id = %s,
                   counter_channel_id = %s
             WHERE id = %s
            """,
            (match_id, i["channel_id"], o["id"]),
        )
        cur.execute(
            """
            UPDATE transactions
               SET match_id = %s,
                   counter_channel_id = %s
             WHERE id = %s
            """,
            (match_id, o["channel_id"], i["id"]),
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--since", help="ISO date (e.g. 2026-04-01)")
    args = ap.parse_args()

    since = None
    if args.since:
        since = datetime.fromisoformat(args.since)

    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    rows = fetch_candidates(cur, since)
    print(f"unmatched candidates: {len(rows)}")

    pairs = match_pairs(rows)
    print(f"matched pairs: {len(pairs)}")
    print()

    for o, i, gap in pairs[:30]:
        print(
            f"  {o['occurred_at'].date()}  {abs(o['amount']):>12,.0f}  "
            f"OUT[{o['description'][:18]:<18}]  →  IN[{i['description'][:18]:<18}]  "
            f"(gap {gap/60:.0f}m)"
        )
    if len(pairs) > 30:
        print(f"  ... and {len(pairs)-30} more")

    if args.dry_run:
        print("\n(dry-run — no changes)")
        return

    apply_pairs(cur, pairs)
    conn.commit()
    print(f"\n✅ applied: {len(pairs)} pairs ({len(pairs)*2} rows updated)")


if __name__ == "__main__":
    main()
