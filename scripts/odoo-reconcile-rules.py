#!/usr/bin/env python3
"""
Odoo Bank Reconciliation — 자동 분류 규칙 생성
finanz category-rules.md 기반으로 account.reconcile.model 생성
"""

import xmlrpc.client
import sys

# Odoo 접속 정보
URL = 'https://odoo.intellieffect.com'
DB = 'intellieffect'
USER = 'bruce@intellieffect.com'
API_KEY = '873c1dcf8df39b03ad497b04e094ce68f35da23a'
COMPANY_ID = 3

# Connect
common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common')
uid = common.authenticate(DB, USER, API_KEY, {})
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object')

def call(model, method, *args, **kwargs):
    return models.execute_kw(DB, uid, API_KEY, model, method, *args, **kwargs)


# ============================================================
# STEP 1: 필요한 계정과목 생성 (없는 것만)
# ============================================================

# 기존 계정 조회
existing_accounts = call('account.account', 'search_read',
    [[['company_ids', 'in', [COMPANY_ID]]]],
    {'fields': ['id', 'code', 'name', 'account_type']})

account_by_name = {a['name']: a for a in existing_accounts}
account_by_id = {a['id']: a for a in existing_accounts}

print(f"기존 계정과목: {len(existing_accounts)}개")

# 생성할 계정과목 (한국 CoA에 없는 것들)
NEW_ACCOUNTS = [
    {'code': '821', 'name': '통신비', 'account_type': 'expense'},
    {'code': '822', 'name': '보험료', 'account_type': 'expense'},
    {'code': '823', 'name': '여비교통비', 'account_type': 'expense'},
    {'code': '824', 'name': '차량유지비', 'account_type': 'expense'},
    {'code': '825', 'name': '소모품비', 'account_type': 'expense'},
    {'code': '826', 'name': '지급수수료', 'account_type': 'expense'},
    {'code': '827', 'name': '도서인쇄비', 'account_type': 'expense'},
    {'code': '828', 'name': '의료비', 'account_type': 'expense'},
    {'code': '829', 'name': '반려동물비', 'account_type': 'expense'},
    {'code': '830', 'name': '세탁비', 'account_type': 'expense'},
    {'code': '831', 'name': '교육훈련비', 'account_type': 'expense'},
    {'code': '832', 'name': '외환차손익', 'account_type': 'expense'},
    {'code': '833', 'name': '공과금', 'account_type': 'expense'},
]

created_accounts = {}
for acc in NEW_ACCOUNTS:
    if acc['name'] in account_by_name:
        created_accounts[acc['name']] = account_by_name[acc['name']]['id']
        print(f"  ✓ {acc['name']} 이미 존재 (ID: {account_by_name[acc['name']]['id']})")
    else:
        try:
            new_id = call('account.account', 'create', [{
                'code': acc['code'],
                'name': acc['name'],
                'account_type': acc['account_type'],
                'company_ids': [(4, COMPANY_ID)],
            }])
            created_accounts[acc['name']] = new_id
            account_by_name[acc['name']] = {'id': new_id, 'code': acc['code'], 'name': acc['name']}
            print(f"  + {acc['name']} 생성 (ID: {new_id})")
        except Exception as e:
            print(f"  ✗ {acc['name']} 생성 실패: {e}")

# Refresh accounts
existing_accounts = call('account.account', 'search_read',
    [[['company_ids', 'in', [COMPANY_ID]]]],
    {'fields': ['id', 'code', 'name', 'account_type']})
account_by_name = {a['name']: a for a in existing_accounts}

def get_account_id(name):
    """계정과목 이름으로 ID 조회"""
    if name in account_by_name:
        return account_by_name[name]['id']
    raise ValueError(f"계정과목 '{name}' 없음")


# ============================================================
# STEP 2: 카테고리 → 계정과목 매핑 + 매칭 규칙 정의
# ============================================================

# 각 규칙: (규칙이름, 매칭패턴들, 계정과목이름)
# 매칭 패턴은 match_label_param에 들어감 (contains 매칭)
RULES = [
    # === income ===
    ('수입-위스피온급여', ['위스피온급여'], 'Sales Income - Goods'),
    ('수입-이랜서', ['이랜서'], 'Sales Income - Goods'),
    ('수입-위시켓', ['위시켓'], 'Sales Income - Goods'),
    ('수입-라이즌', ['라이즌'], 'Sales Income - Goods'),
    ('수입-유버', ['유버'], 'Sales Income - Goods'),
    ('수입-국고지원금', ['국고_인텔리이펙트'], 'Sales Income - Goods'),
    ('수입-당근마켓', ['당근 캐로롯'], 'Sales Income - Goods'),

    # === payroll ===
    ('인건비-장동진', ['장동진'], 'Salaries'),
    ('인건비-양진호', ['양진호'], 'Salaries'),
    ('인건비-진기혁', ['진기혁'], 'Salaries'),
    ('인건비-박현주', ['박현주'], 'Salaries'),
    ('인건비-최석규', ['최석규'], 'Salaries'),
    ('인건비-김민수', ['김민수'], 'Salaries'),
    ('인건비-원유빈', ['원유빈'], 'Salaries'),

    # === rent ===
    ('주거-월세', ['롯데캐슬'], 'Rent Expense'),
    ('주거-관리비', ['하남미사롯데'], 'Rent Expense'),
    ('주거-미사관리', ['미사 1-2', '미사1-2'], 'Rent Expense'),

    # === office_rent ===
    ('사무실-임대', ['에스에이치개발'], 'Rent Expense'),
    ('사무실-관리', ['어뮤즈스퀘어'], 'Rent Expense'),

    # === subscription ===
    ('구독-Claude', ['CLAUDE.AI'], '지급수수료'),
    ('구독-OpenAI', ['OPENAI'], '지급수수료'),
    ('구독-Notion', ['NOTION LABS'], '지급수수료'),
    ('구독-Google', ['GOOGLE*DIGITAL', 'Google Digital'], '지급수수료'),
    ('구독-GSuite', ['GOOGLE*GSUITE'], '지급수수료'),
    ('구독-GCP', ['구글클라우드코리아'], '지급수수료'),
    ('구독-AWS', ['Amazon_AWS_KCP'], '지급수수료'),
    ('구독-Canva', ['CANVA'], '지급수수료'),
    ('구독-Runway', ['RUNWAY'], '지급수수료'),
    ('구독-KlingAI', ['KLINGAI'], '지급수수료'),
    ('구독-ManusAI', ['MANUS AI'], '지급수수료'),
    ('구독-Apple', ['Apple Serv'], '지급수수료'),
    ('구독-Telegram', ['Telegram Premium'], '지급수수료'),
    ('구독-디즈니', ['월트디즈니'], '지급수수료'),
    ('구독-리디', ['리디 주식회사'], '지급수수료'),
    ('구독-가비아', ['가비아'], '지급수수료'),
    ('구독-토스구독', ['토스페이_TOSS', '토스페이_컨텐츠_TOSS'], '지급수수료'),
    ('구독-SK쉴더스', ['에스케이쉴더스'], '지급수수료'),
    ('구독-마이시큐리티', ['마이시큐리티'], '지급수수료'),
    ('구독-카카오', ['주식회사 카카오'], '지급수수료'),
    ('구독-이지피쥐', ['이지피쥐'], '지급수수료'),

    # === telecom ===
    ('통신-LGU+', ['LG U+ 통신요금', '엘지유플러스'], '통신비'),
    ('통신-KT', ['KT통신요금'], '통신비'),

    # === insurance ===
    ('보험-메리츠', ['메리츠통합'], '보험료'),
    ('보험-건강보험', ['건강보험공단'], '보험료'),

    # === tax ===
    ('세금-국세', ['국세_인텔리이펙트', '토스 국세_인'], 'Taxes and Dues'),
    ('세금-세무', ['경기광주세무'], 'Taxes and Dues'),
    ('세금-지방세하남', ['경기하남시'], 'Taxes and Dues'),
    ('세금-지방세원주', ['강원원주시'], 'Taxes and Dues'),
    ('세금-환급', ['환급경기하남'], 'Taxes and Dues'),
    ('세금-지자체', ['지자체세입금'], 'Taxes and Dues'),

    # === accounting ===
    ('세무-자비스', ['자비스'], '지급수수료'),

    # === fuel ===
    ('연료-GS칼텍스', ['GS칼텍스'], '차량유지비'),
    ('연료-충전소', ['충전소'], '차량유지비'),
    ('연료-주유소', ['주유소'], '차량유지비'),

    # === cafe ===
    ('카페-스타벅스', ['스타벅스'], 'Fringe Benefits'),
    ('카페-이디야', ['이디야'], 'Fringe Benefits'),
    ('카페-컴포즈', ['컴포즈'], 'Fringe Benefits'),
    ('카페-탐앤탐스', ['탐앤탐스'], 'Fringe Benefits'),
    ('카페-할리스', ['할리스'], 'Fringe Benefits'),
    ('카페-엔커피', ['엔커피'], 'Fringe Benefits'),
    ('카페-공차', ['공차'], 'Fringe Benefits'),
    ('카페-폴바셋', ['폴바셋'], 'Fringe Benefits'),
    ('카페-매머드', ['매머드'], 'Fringe Benefits'),
    ('카페-OAKBERRY', ['OAKBERRY'], 'Fringe Benefits'),

    # === dining ===
    ('식사-닭갈비', ['닭갈비'], 'Fringe Benefits'),
    ('식사-감자탕', ['감자탕'], 'Fringe Benefits'),
    ('식사-횟집', ['횟집'], 'Fringe Benefits'),
    ('식사-냉면', ['냉면'], 'Fringe Benefits'),
    ('식사-칼국수', ['칼국수'], 'Fringe Benefits'),
    ('식사-파스타', ['파스타'], 'Fringe Benefits'),
    ('식사-라멘', ['라멘'], 'Fringe Benefits'),
    ('식사-스시', ['스시'], 'Fringe Benefits'),
    ('식사-우동', ['우동'], 'Fringe Benefits'),
    ('식사-치킨', ['치킨'], 'Fringe Benefits'),
    ('식사-맥도날드', ['맥도날드'], 'Fringe Benefits'),
    ('식사-버거', ['버거'], 'Fringe Benefits'),
    ('식사-피자', ['피자'], 'Fringe Benefits'),
    ('식사-롯데리아', ['롯데리아'], 'Fringe Benefits'),
    ('식사-써브웨이', ['써브웨이'], 'Fringe Benefits'),
    ('식사-순대', ['순대'], 'Fringe Benefits'),
    ('식사-만두', ['만두'], 'Fringe Benefits'),
    ('식사-김밥', ['김밥'], 'Fringe Benefits'),
    ('식사-떡볶이', ['떡볶이'], 'Fringe Benefits'),
    ('식사-양꼬치', ['양꼬치'], 'Fringe Benefits'),
    ('식사-불고기', ['불고기'], 'Fringe Benefits'),
    ('식사-고기', ['고기'], 'Fringe Benefits'),

    # === shopping ===
    ('쇼핑-신세계', ['신세계'], '소모품비'),
    ('쇼핑-이케아', ['이케아'], '소모품비'),
    ('쇼핑-스타필드', ['스타필드'], '소모품비'),
    ('쇼핑-롯데마트', ['롯데마트'], '소모품비'),
    ('쇼핑-코스트코', ['코스트코'], '소모품비'),
    ('쇼핑-다이소', ['다이소'], '소모품비'),
    ('쇼핑-올리브영', ['올리브영'], '소모품비'),
    ('쇼핑-쿠팡', ['쿠팡(쿠페이)'], '소모품비'),
    ('쇼핑-애플코리아', ['애플코리아'], '소모품비'),
    ('쇼핑-엘지전자', ['엘지전자'], '소모품비'),

    # === medical ===
    ('의료-치과', ['치과'], '의료비'),
    ('의료-의원', ['의원'], '의료비'),
    ('의료-약국', ['약국'], '의료비'),
    ('의료-피부과', ['피부과'], '의료비'),

    # === transport ===
    ('교통-카카오T', ['카카오T', '카카오모빌리티'], '여비교통비'),
    ('교통-주차', ['파킹', '주차'], '여비교통비'),
    ('교통-렌탈', ['롯데렌탈'], '여비교통비'),
    ('교통-항공', ['아시아나항공'], '여비교통비'),
    ('교통-관리공단', ['도시관리공단', '시설관리공단'], '여비교통비'),
    ('교통-후불교통', ['후불교통', '교통카드'], '여비교통비'),

    # === cashback ===
    ('캐시백', ['카드 캐시백'], 'Miscellaneous Income'),
    ('캐시백-프로모션', ['프로모션입금'], 'Miscellaneous Income'),
    ('캐시백-토스포인트', ['토스 포인트'], 'Miscellaneous Income'),
    ('캐시백-신한', ['신한카드캐시백'], 'Miscellaneous Income'),

    # === interest ===
    ('이자수익', ['이자'], 'Interest Income'),

    # === pet ===
    ('반려동물-병원', ['정직동물병원'], '반려동물비'),
    ('반려동물-용품', ['개밥', '견생냥품', '야옹아멍멍'], '반려동물비'),

    # === laundry ===
    ('세탁-하우스디', ['하우스디'], '세탁비'),
    ('세탁-빨래', ['빨래'], '세탁비'),
    ('세탁-런드리', ['런드리'], '세탁비'),
    ('세탁-워시프레쉬', ['워시프레쉬'], '세탁비'),

    # === entertainment ===
    ('오락-엔터', ['오락', '놀이'], 'Entertainment Expense'),

    # === convenience ===
    ('편의점-CU', ['씨유', 'CU '], '소모품비'),
    ('편의점-GS25', ['GS25', 'GS리테일'], '소모품비'),
    ('편의점-세븐일레븐', ['세븐일레븐'], '소모품비'),

    # === public_fee ===
    ('공과금', ['수도요금', '전기요금', '가스요금'], '공과금'),

    # === donation ===
    ('기부', ['기부'], 'Donations'),

    # === bank_fee ===
    ('수수료-은행', ['수수료'], '지급수수료'),

    # === car_wash ===
    ('세차', ['세차'], '차량유지비'),

    # === self_transfer (내부이체) ===
    ('내부이체-최종혁', ['최종혁'], 'Liquidity Transfer'),
    ('내부이체-카카오페이', ['카카오페이'], 'Liquidity Transfer'),
    ('내부이체-네이버페이충전', ['네이버페이충전'], 'Liquidity Transfer'),
    ('내부이체-토스페이충전', ['토스페이 충전'], 'Liquidity Transfer'),

    # === card_payment ===
    ('카드대금-현대', ['현대카드'], 'Liquidity Transfer'),
    ('카드대금-신한', ['신한카드'], 'Liquidity Transfer'),
    ('카드대금-삼성', ['삼성카드'], 'Liquidity Transfer'),
]


# ============================================================
# STEP 3: Reconciliation Model 생성
# ============================================================

# 기존 규칙 확인 (중복 방지)
existing_models = call('account.reconcile.model', 'search_read',
    [[['company_id', '=', COMPANY_ID]]],
    {'fields': ['id', 'name']})
existing_names = {m['name'] for m in existing_models}

created_count = 0
skipped_count = 0
errors = []

print(f"\n{'='*60}")
print(f"Reconciliation Model 생성 시작")
print(f"{'='*60}")

for rule_name, patterns, account_name in RULES:
    if rule_name in existing_names:
        print(f"  ⊘ {rule_name} — 이미 존재, 스킵")
        skipped_count += 1
        continue

    try:
        account_id = get_account_id(account_name)
    except ValueError as e:
        errors.append(f"{rule_name}: {e}")
        print(f"  ✗ {rule_name} — 계정 '{account_name}' 없음")
        continue

    # 패턴이 여러 개면 각각 별도 규칙 생성 (Odoo는 match_label_param이 단일 문자열)
    for pattern in patterns:
        full_name = f"{rule_name}" if len(patterns) == 1 else f"{rule_name}({pattern})"

        if full_name in existing_names:
            skipped_count += 1
            continue

        try:
            model_id = call('account.reconcile.model', 'create', [{
                'name': full_name,
                'trigger': 'manual',  # manual suggestion (사용자가 조정 시 자동 제안)
                'match_label': 'contains',
                'match_label_param': pattern,
                'company_id': COMPANY_ID,
                'line_ids': [(0, 0, {
                    'account_id': account_id,
                    'amount_type': 'percentage',
                    'amount_string': '100',
                    'label': rule_name,
                })],
            }])
            created_count += 1
            print(f"  ✓ {full_name} → {account_name} (ID: {model_id})")
        except Exception as e:
            errors.append(f"{full_name}: {e}")
            print(f"  ✗ {full_name} — 생성 실패: {e}")


# ============================================================
# STEP 4: 결과 리포트
# ============================================================

print(f"\n{'='*60}")
print(f"결과 요약")
print(f"{'='*60}")
print(f"생성: {created_count}개")
print(f"스킵 (이미 존재): {skipped_count}개")
print(f"에러: {len(errors)}개")

if errors:
    print(f"\n에러 목록:")
    for e in errors:
        print(f"  - {e}")


# ============================================================
# STEP 5: 매칭 테스트 — 미조정 거래 중 몇 건이 규칙에 매칭되는지
# ============================================================

print(f"\n{'='*60}")
print(f"매칭 테스트")
print(f"{'='*60}")

# 전체 미조정 거래 조회
unreconciled = call('account.bank.statement.line', 'search_read',
    [[['company_id', '=', COMPANY_ID], ['is_reconciled', '=', False]]],
    {'fields': ['id', 'payment_ref', 'amount'], 'limit': 5000})

print(f"미조정 거래: {len(unreconciled)}건")

# 규칙별 매칭 카운트
all_rules = call('account.reconcile.model', 'search_read',
    [[['company_id', '=', COMPANY_ID]]],
    {'fields': ['id', 'name', 'match_label_param']})

matched_ids = set()
rule_match_counts = {}

for rule in all_rules:
    pattern = (rule['match_label_param'] or '').lower()
    if not pattern:
        continue
    count = 0
    for line in unreconciled:
        ref = (line['payment_ref'] or '').lower()
        if pattern in ref:
            count += 1
            matched_ids.add(line['id'])
    if count > 0:
        rule_match_counts[rule['name']] = count

# 정렬 출력
sorted_rules = sorted(rule_match_counts.items(), key=lambda x: -x[1])
total_matched = len(matched_ids)

print(f"\n규칙별 매칭 건수 (상위 30):")
print(f"{'규칙이름':<40} {'매칭건수':>8}")
print(f"{'-'*48}")
for name, count in sorted_rules[:30]:
    print(f"{name:<40} {count:>8}")

print(f"\n총 매칭: {total_matched}건 / {len(unreconciled)}건 ({total_matched/len(unreconciled)*100:.1f}%)")
print(f"미매칭: {len(unreconciled) - total_matched}건")


# ============================================================
# STEP 6: 매핑 테이블 출력
# ============================================================

print(f"\n{'='*60}")
print(f"카테고리 → 계정과목 매핑 테이블")
print(f"{'='*60}")
print(f"{'카테고리':<25} {'계정과목':<25} {'유형':<15}")
print(f"{'-'*65}")

CATEGORY_MAPPING = {
    'income': 'Sales Income - Goods',
    'payroll': 'Salaries',
    'rent': 'Rent Expense',
    'office_rent': 'Rent Expense',
    'subscription': '지급수수료',
    'telecom': '통신비',
    'insurance': '보험료',
    'tax': 'Taxes and Dues',
    'accounting': '지급수수료',
    'fuel': '차량유지비',
    'cafe': 'Fringe Benefits',
    'dining': 'Fringe Benefits',
    'shopping': '소모품비',
    'medical': '의료비',
    'transport': '여비교통비',
    'cashback': 'Miscellaneous Income',
    'interest': 'Interest Income',
    'pet': '반려동물비',
    'laundry': '세탁비',
    'entertainment': 'Entertainment Expense',
    'convenience': '소모품비',
    'dessert': 'Fringe Benefits',
    'public_fee': '공과금',
    'donation': 'Donations',
    'bank_fee': '지급수수료',
    'car_wash': '차량유지비',
    'hobby': 'Entertainment Expense',
    'grocery': '소모품비',
    'maintenance': '소모품비',
    'housing': 'Rent Expense',
    'education': '교육훈련비',
    'personal_care': 'Fringe Benefits',
    'forex': '외환차손익',
    'self_transfer': 'Liquidity Transfer',
    'card_payment': 'Liquidity Transfer',
    'payment_platform': 'Liquidity Transfer',
    'personal_transfer': '(별도처리)',
    'verification': '(스킵)',
    'atm': '(별도처리)',
}

for cat, acc in sorted(CATEGORY_MAPPING.items()):
    cat_type = 'income' if acc in ['Sales Income - Goods', 'Miscellaneous Income', 'Interest Income'] else \
               'internal' if acc == 'Liquidity Transfer' else \
               'skip' if acc.startswith('(') else 'expense'
    print(f"{cat:<25} {acc:<25} {cat_type:<15}")

print(f"\n✅ 완료!")
