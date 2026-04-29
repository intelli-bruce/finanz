#!/usr/bin/env python3
"""
Odoo Bank Reconciliation — AI 분류 + 조정 실행
Usage:
  python3 odoo-ai-classify.py              # dry-run
  python3 odoo-ai-classify.py --execute    # 실제 조정
"""

import xmlrpc.client
import sys
from collections import defaultdict

URL = 'https://odoo.intellieffect.com'
DB = 'intellieffect'
USER = 'bruce@intellieffect.com'
API_KEY = '873c1dcf8df39b03ad497b04e094ce68f35da23a'
COMPANY_ID = 3

common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common')
uid = common.authenticate(DB, USER, API_KEY, {})
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object')

def call(model, method, *args, **kwargs):
    return models.execute_kw(DB, uid, API_KEY, model, method, *args, **kwargs)

# ============================================================
# 기초 데이터
# ============================================================
print("=" * 60)
print("기초 데이터 조회")
print("=" * 60)

accounts = call('account.account', 'search_read',
    [[['company_ids', 'in', [COMPANY_ID]]]],
    {'fields': ['id', 'code', 'name', 'account_type']})
acc_by_name = {a['name']: a for a in accounts}

# 핵심 계정 ID
ACC = {
    'income': 347,       # Miscellaneous Income
    'loss': 362,         # Miscellaneous Loss
    'sales': acc_by_name.get('Sales Income - Goods', {}).get('id'),
    'salaries': 322,
    'fringe': 324,       # Fringe Benefits (복리후생비)
    'rent': 325,
    'entertainment': 326,
    'tax': 329,
    'interest_inc': acc_by_name.get('Interest Income', {}).get('id'),
    'donation': 356,
    'telecom': 383,
    'insurance': 384,
    'transport': 385,    # 여비교통비
    'car': 386,          # 차량유지비
    'supplies': 387,     # 소모품비
    'fee': 388,          # 지급수수료
    'medical': 390,
    'pet': 391,
    'laundry': 392,
    'education': 393,
    'forex': 394,
    'utility': 395,      # 공과금
    'liquidity': acc_by_name.get('Liquidity Transfer', {}).get('id'),
}

unreconciled = call('account.bank.statement.line', 'search_read',
    [[['company_id', '=', COMPANY_ID], ['is_reconciled', '=', False]]],
    {'fields': ['id', 'date', 'payment_ref', 'amount', 'journal_id', 'move_id'],
     'limit': 5000})
print(f"미조정 거래: {len(unreconciled)}건")

journals = call('account.journal', 'search_read',
    [[['company_id', '=', COMPANY_ID], ['type', '=', 'bank']]],
    {'fields': ['id', 'name', 'default_account_id', 'suspense_account_id']})
journal_by_id = {j['id']: j for j in journals}

# Suspense 계정 ID들
SUSPENSE_ACCS = {367, 209, 210, 211, 373, 374, 287}

# ============================================================
# 분류 함수
# ============================================================
def classify(ref_raw, amount):
    ref = (ref_raw or '').strip()
    ref_l = ref.lower()
    
    # Self-transfer
    if any(p in ref for p in ['최종혁', '이랜서최종혁', '네이버페이충전', '토스페이 충전', '토스페이충전']):
        return ('self_transfer', ACC['liquidity'])
    
    # Card payment
    if any(p in ref for p in ['현대카드', '신한카드', '삼성카드']):
        return ('card_payment', ACC['liquidity'])
    
    # Payment platform
    if ref in ('토스페이', '카카오페이', '네이버페이'):
        return ('payment_platform', ACC['liquidity'])
    if ref.startswith('카카오페이') and '카카오페이_' not in ref and amount < 0:
        return ('payment_platform', ACC['liquidity'])
    if ref.startswith('네이버페이') and amount < 0 and len(ref) < 10:
        return ('payment_platform', ACC['liquidity'])
    
    # Income
    if any(p in ref for p in ['위스피온급여', '(주)이랜서', '(주)위시켓', '주식회사 라이즌', '유버(주)', '국고_인텔리', '당근 캐로롯']):
        return ('income', ACC['sales'])
    
    # Payroll
    if any(p in ref for p in ['장동진', '양진호', '진기혁', '박현주', '최석규', '김민수', '원유빈']):
        return ('payroll', ACC['salaries'])
    
    # Rent
    if any(p in ref for p in ['롯데캐슬', '하남미사롯데', '미사 1-2', '미사1-2']):
        return ('rent', ACC['rent'])
    if any(p in ref for p in ['에스에이치개발', '어뮤즈스퀘어', '사무실 임대료']):
        return ('office_rent', ACC['rent'])
    
    # Subscription
    sub = ['CLAUDE.AI', 'OPENAI', 'CHATGPT', 'NOTION LABS', 'GOOGLE*DIGITAL', 'Google Digital',
        'GOOGLE*GSUITE', 'Google GSUITE', '구글클라우드코리아', 'Amazon_AWS', 'CANVA', 'RUNWAY',
        'KLINGAI', 'MANUS AI', 'Apple Serv', 'Telegram Premium', '월트디즈니',
        '리디 주식회사', '가비아', '토스페이_TOSS', '토스페이_컨텐츠',
        '에스케이쉴더스', '마이시큐리티', '주식회사 카카오', '이지피쥐',
        'GITHUB', 'VERCEL', 'ANTHROPIC', 'Anthropic', 'SENTRY', 'NETLIFY',
        'HEROKU', 'SUPABASE', 'FIGMA', 'SLACK', 'ZOOM', 'CURSOR',
        'LINEAR', 'RETOOL', 'AIRTABLE', 'DROPBOX',
        'MIDJOURNEY', 'STABILITY', 'PERPLEXITY',
        'GRAMMARLY', '1PASSWORD', 'DEEPL',
        'HETZNER', 'DIGITALOCEAN', 'CLOUDFLARE', 'NAMECHEAP',
        'JetBrains', 'JETBRAINS', 'MANYCHAT', 'UPSTASH', 'OBSIDIAN', 'WL *Odoo',
        'CLICKS TECHNOLOGY', 'Netflix', 'My 구독', '톡서랍', '톡클라우드']
    if any(p.lower() in ref_l for p in sub):
        return ('subscription', ACC['fee'])
    
    # Tax
    if any(p in ref for p in ['국세_인텔리', '토스 국세', '경기광주세무', '경기하남시', '강원원주시', '환급경기하남', '지자체세입금', '토스 경기', '경찰청']):
        return ('tax', ACC['tax'])
    
    # Accounting
    if any(p in ref for p in ['자비스', '세무법인']):
        return ('accounting', ACC['fee'])
    
    # Telecom
    if any(p in ref for p in ['LG U+ 통신요금', '엘지유플러스', 'KT통신요금', 'LGU']):
        return ('telecom', ACC['telecom'])
    
    # Insurance
    if any(p in ref for p in ['메리츠통합', '건강보험공단']):
        return ('insurance', ACC['insurance'])
    
    # Fuel
    if any(p in ref for p in ['GS칼텍스', '충전소', '주유소', 'SK에너지', 'S-OIL', '동서울오일', '(주)성남에너지']):
        return ('fuel', ACC['car'])
    
    # Cafe
    cafe = ['스타벅스', '이디야', '컴포즈', '탐앤탐스', '할리스', '엔커피', '공차',
        '폴바셋', '매머드', 'OAKBERRY', '빽다방', '메가커피', '투썸', '커피빈',
        '파스쿠찌', '블루보틀', '더벤티', '감성커피', '바나프레소',
        '메가엠지씨', '하남시청DT', '우지커피', '커피나인', '벤티프레소', 'COFFEE린',
        '달리는커피', '백억커피', '레트커피', '레벨업PC', '맥스PC',
        '버드랜드커피', '콩카페', '어빌리지커피', '(주)브로든커피', '카페BDC', '신신카페',
        '데일리오아시스', '크레마팜', '베르그 서울숲', '(주)오픈커피로스터스',
        '카페 요아정', '콘블리', '더송스하우스', '로스토리', '달콤 뻥튀기']
    if any(p in ref for p in cafe):
        return ('cafe', ACC['fringe'])
    
    # Dessert
    dessert = ['설빙', '배스킨라빈스', '뚜레쥬르', '파리바게뜨', '크리스피', '베이커리',
        '던킨', '이스트 베이글', '아이스크림살래', '쮸쮸아이스크림', '파리크라상',
        '스무디킹', '(주)래딕스플러스', '요거트맨', '소복소복', '스테비아', '스낵월드', '와플대학']
    if any(p in ref for p in dessert):
        return ('dessert', ACC['fringe'])
    
    # Dining
    dining = ['닭갈비', '감자탕', '횟집', '냉면', '칼국수', '파스타', '라멘', '스시',
        '우동', '치킨', '맥도날드', '버거', '피자', '롯데리아', '써브웨이',
        '순대', '만두', '김밥', '떡볶이', '양꼬치', '불고기', '고기',
        '비빔밥', '국밥', '갈비', '삼겹살', '족발', '보쌈', '짬뽕', '짜장',
        '식당', '레스토랑', '도시락', '뷔페', '샐러드',
        '배달의민족', '요기요', '쿠팡이츠', '배민',
        '교촌', '굽네', 'BHC', 'BBQ', '네네', '또래오래',
        'KFC', 'SUBWAY', 'BURGER KING',
        '빕스', '아웃백', '애슐리',
        '찌개', '볶음', '구이', '덮밥', '카레', '샌드위치', '토스트',
        '순도리', '국수', '면옥', '돈가스', '돈까스', '통돈가스',
        '반점', '우마주', '동남집', '밥플러스', '미미고', '솔티',
        '구포국수', '사미반점', '해장국', '육개장', '삼덕통닭',
        '청와옥', '부산어묵', '백소정', '명품한우', '오징어포차',
        '초장집', '아라치', '와하카', '더불닭', '더쿠킹', '굿푸드',
        '행복회수산', '(주)청와옥', '포시즌키친', '소당깨', '촌놈',
        '민생시장', '대관령황태', '샤브올데이', '깜(KKAM)', '마담파이',
        '(주)제이앤엘', '(주)따스한', '고메스퀘어', '화이트리에',
        '아우프글렛', '오근내', '(주)골목오리', '더커플',
        '함경면옥', '속초오징어', '비비큐 빌리지', '반 치앙마이',
        '(주)어번그룹', '초대', '정든', '피카워크샵',
        '(주)리앤푸드', '리앤푸드', '이곳에(IGOCCEE)',
        '콘타이', '(주)스윗솔트', '수(Soo)', '두평판',
        '(주)수협유통', '(주)월드식자재', '(주)텃밭식자재', '과일사랑',
        '강선규', '샐러리아', '드림디포', '중앙닭강정',
        '(사)한국고속도로', '랭킹닭컴', '득근파티',
        '호반프라퍼티', '로우키', '통닭', '가든갤러리', '휘바',
        '(주)스낵월드 화정', '(주)에스디인터내셔날',
        '(주)창미', '제이영동', '꽃밭',
    ]
    if any(p in ref for p in dining):
        return ('dining', ACC['fringe'])
    
    # Shopping
    shopping = ['신세계', '이케아', '스타필드', '롯데마트', '코스트코', '다이소',
        '올리브영', '쿠팡(쿠페이)', '애플코리아', '엘지전자', '롯데백화점',
        '현대백화점', '롯데월드몰', '무신사', '삼성전자', '하이마트',
        'AMAZON', 'Amazon', '알리익스프레스', 'TEMU',
        '(주)이니시스', '한국정보통신 - 쿠팡', 'KCP - 쿠팡', '나이스 - 쿠팡',
        '(주)컨플릭트', '유니클로', '(주)이랜드', 'Starfield',
        '롯데에비뉴엘', '(주)에이치마트', '원주농협하나로', '현대백중동',
        '교보문고', '롯데시네마', '11번가', '슈엘로 안경',
        'Apple 아이폰', 'LG전 자', 'LG전자']
    if any(p in ref for p in shopping):
        return ('shopping', ACC['supplies'])
    
    # Medical
    if any(p in ref for p in ['치과', '의원', '약국', '피부과', '병원', '안과', '이비인후과', '정형외과', '내과', '한의원', '클리닉', '이소틴']):
        return ('medical', ACC['medical'])
    
    # Transport
    transport = ['카카오T', '카카오모빌리티', '파킹', '주차', '롯데렌탈', '아시아나항공',
        '도시관리공단', '시설관리공단', '후불교통', '교통카드', '티머니',
        '대한항공', '제주항공', '진에어', '트립닷컴', '교통비',
        '서울올림픽기념', '버스타고', '아마노코리아',
        '한국교통안전', '교통안전공단']
    if any(p in ref for p in transport):
        return ('transport', ACC['transport'])
    
    # Pet
    pet = ['정직동물병원', '개밥', '견생냥품', '야옹아멍멍', '동물병원',
        '반려동물', '강아지', '펫먼트', '독스랩', '딩동펫', '블루펫',
        '배변패드', '배변봉투', '퍼피사료', '브릿 프', '제로랩스',
        '펫코', '펫픽어스', '코멧 펫', '타오진 반려',
        '닥터블랭크', '하이포닉', '배변매트']
    if any(p in ref for p in pet):
        return ('pet', ACC['pet'])
    
    # Laundry
    if any(p in ref for p in ['하우스디', '빨래', '런드리', '워시프레쉬', '세탁', '크린토피아', '아띠제헤어']):
        return ('laundry', ACC['laundry'])
    
    # Convenience
    if any(p in ref for p in ['씨유', 'CU ', 'GS25', 'GS리테일', '세븐일레븐', '이마트24']):
        return ('convenience', ACC['supplies'])
    
    # Utility
    if any(p in ref for p in ['수도요금', '전기요금', '가스요금', '한국전력', '공공서비스요금', '서울에너지', '기금조성']):
        return ('utility', ACC['utility'])
    
    # Cashback
    if any(p in ref for p in ['카드 캐시백', '프로모션입금', '토스 포인트', '신한카드캐시백', '캐시백',
                               '체크카드 복권', 'tosspaymen', '카카오페이상품권', 'e카드', '모으기 해지']):
        return ('cashback', ACC['income'])
    
    # Interest
    if '이자' in ref:
        return ('interest', ACC['interest_inc'])
    
    # Car
    if any(p in ref for p in ['세차', '현대자동차', 'NEXO', '넥쏘']):
        return ('car', ACC['car'])
    
    # Forex
    if any(p in ref for p in ['자동환전', '부족한돈', '카드환전', 'VND 팔기', 'VND 사기']):
        return ('forex', ACC['forex'])
    
    # Fee
    if any(p in ref for p in ['결제_KCP', '수수료', '시그마페이먼트', '한국전자금융',
                              '엔에이치엔케이씨피', '엔에이치엔 주식회사', '라이트비전',
                              'KR-GOOGLE', '나이스 - 나이스', '나인투원',
                              '디지털공간연구소', '(주)엑스터디', '토스페이먼츠 - 토스페이먼츠']):
        return ('fee', ACC['fee'])
    
    # Verification
    if any(p in ref for p in ['카카오218', 'LGU203', '전자인증', '토스828', '토스019',
                              '토스465', '토스605', '토스775', '카카오523', '카카오442',
                              '네이버2091', '네이버4821', '9899삼성', '074095', '인증용',
                              '목성사과']):
        return ('verification', ACC['income'])
    
    # Entertainment
    if any(p in ref for p in ['메가박스', 'CGV', 'Equal Sensation',
                              '브레인파크', '에이치디씨리조트', '국군복지단',
                              '엘더(Elder)', '빅풋']):
        return ('entertainment', ACC['entertainment'])
    
    # Housing/Building
    if any(p in ref for p in ['서울숲엠타워', '에이스코아', '성수선명스퀘어', '사단법인경포동',
                              '호텔나루', '소피텔앰배서더', '동림홀딩스', '롯데물산', '아르누보']):
        return ('housing', ACC['rent'])
    
    # ATM
    if 'ATM' in ref:
        return ('atm', ACC['liquidity'])
    
    # Apple 서비스
    if 'Apple 서비스' in ref:
        return ('apple_refund' if amount > 0 else 'subscription', ACC['income'] if amount > 0 else ACC['fee'])
    
    # 쿠팡/온라인 쇼핑 (긴 제품명)
    if len(ref) > 30 and amount < 0:
        return ('shopping_online', ACC['supplies'])
    
    # 기본 fallback
    if amount > 0:
        return ('unclassified_income', ACC['income'])
    else:
        return ('unclassified_expense', ACC['loss'])


# ============================================================
# 분류 + 통계
# ============================================================
print("\n분류 중...")
classifications = []
cat_stats = defaultdict(lambda: {'count': 0, 'total': 0.0})

for line in unreconciled:
    cat, acc_id = classify(line['payment_ref'], line['amount'])
    classifications.append((line, cat, acc_id))
    cat_stats[cat]['count'] += 1
    cat_stats[cat]['total'] += line['amount']

classified = sum(s['count'] for c, s in cat_stats.items() if 'unclassified' not in c)
unclassified = sum(s['count'] for c, s in cat_stats.items() if 'unclassified' in c)

print(f"\n{'카테고리':<25} {'건수':>6} {'총액':>15}")
print("-" * 50)
for cat, stats in sorted(cat_stats.items(), key=lambda x: -x[1]['count']):
    print(f"{cat:<25} {stats['count']:>6} {stats['total']:>15,.0f}")

print(f"\n분류: {classified}/{len(unreconciled)} ({classified/len(unreconciled)*100:.1f}%)")
print(f"미분류: {unclassified}건")

# ============================================================
# 조정 실행
# ============================================================
DRY_RUN = '--execute' not in sys.argv

if DRY_RUN:
    uncl = [(l, c) for l, c, a in classifications if 'unclassified' in c]
    if uncl:
        print(f"\n미분류 ({len(uncl)}건):")
        for line, cat in uncl[:30]:
            print(f"  {line['date']} | {(line['payment_ref'] or '')[:50]:<50} | {line['amount']:>10,.0f}")
    print("\n⚠️  DRY RUN. 실행: python3 odoo-ai-classify.py --execute")
    sys.exit(0)

print("\n" + "=" * 60)
print("조정 실행 시작")
print("=" * 60)

# 전체 move_id 수집
move_ids = list(set(
    l['move_id'][0] if isinstance(l['move_id'], (list, tuple)) else l['move_id']
    for l in unreconciled
))

# 배치로 move lines 조회 (성능 최적화)
print(f"Move lines 조회 중... ({len(move_ids)} moves)")
all_move_lines = {}

BATCH = 200
for i in range(0, len(move_ids), BATCH):
    batch = move_ids[i:i+BATCH]
    mls = call('account.move.line', 'search_read',
        [[['move_id', 'in', batch]]],
        {'fields': ['id', 'account_id', 'move_id', 'reconciled']})
    for ml in mls:
        mid = ml['move_id'][0] if isinstance(ml['move_id'], (list, tuple)) else ml['move_id']
        if mid not in all_move_lines:
            all_move_lines[mid] = []
        all_move_lines[mid].append(ml)
    print(f"  {min(i+BATCH, len(move_ids))}/{len(move_ids)}")

print(f"총 {sum(len(v) for v in all_move_lines.values())} move lines 조회 완료")

ok = 0
err = 0
skip = 0
already = 0
errors = []

for i, (line, cat, acc_id) in enumerate(classifications):
    if not acc_id:
        skip += 1
        continue
    
    move_id = line['move_id'][0] if isinstance(line['move_id'], (list, tuple)) else line['move_id']
    move_lines = all_move_lines.get(move_id, [])
    
    # suspense line 찾기
    sus = None
    for ml in move_lines:
        ml_acc = ml['account_id'][0] if isinstance(ml['account_id'], (list, tuple)) else ml['account_id']
        if ml_acc in SUSPENSE_ACCS:
            sus = ml
            break
    
    if not sus:
        # bank account가 아닌 미조정 line 찾기
        j_id = line['journal_id'][0] if isinstance(line['journal_id'], (list, tuple)) else line['journal_id']
        j_info = journal_by_id.get(j_id, {})
        bank_acc = None
        if isinstance(j_info, dict) and j_info.get('default_account_id'):
            bank_acc = j_info['default_account_id'][0] if isinstance(j_info['default_account_id'], (list, tuple)) else j_info['default_account_id']
        for ml in move_lines:
            ml_acc = ml['account_id'][0] if isinstance(ml['account_id'], (list, tuple)) else ml['account_id']
            if ml_acc != bank_acc and not ml['reconciled']:
                sus = ml
                break
    
    if not sus:
        skip += 1
        continue
    
    sus_acc = sus['account_id'][0] if isinstance(sus['account_id'], (list, tuple)) else sus['account_id']
    if sus_acc == acc_id:
        already += 1
        continue
    
    try:
        call('account.move.line', 'write', [[sus['id']], {'account_id': acc_id}])
        ok += 1
    except Exception as e:
        err += 1
        errors.append(f"Line {line['id']}: {e}")
        if err <= 5:
            print(f"  ✗ {line['id']}: {e}")
    
    if (i + 1) % 200 == 0:
        print(f"  {i+1}/{len(classifications)} | ok={ok} err={err} skip={skip} already={already}")

print(f"\n{'='*60}")
print(f"조정 결과")
print(f"{'='*60}")
print(f"성공: {ok}")
print(f"이미완료: {already}")
print(f"스킵: {skip}")
print(f"에러: {err}")

if errors[:10]:
    print("\n에러:")
    for e in errors[:10]:
        print(f"  - {e}")

# 최종 확인
remaining = call('account.bank.statement.line', 'search_count',
    [[['company_id', '=', COMPANY_ID], ['is_reconciled', '=', False]]])
reconciled_now = len(unreconciled) - remaining
print(f"\n잔여 미조정: {remaining}건")
print(f"이번 조정: {reconciled_now}건 ({reconciled_now/len(unreconciled)*100:.1f}%)")
