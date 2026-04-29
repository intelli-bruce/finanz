-- finanz: docs/category-rules.md 1·2단계 적용
-- self_transfer (본인 자산 이동) + card_payment (카드대금) 카테고리 자동 라벨링
-- 양쪽 페어가 DB에 있어 이미 match_id 채워진 거래는 건드리지 않음 (idempotent)

\set toss '''f0988068-9f0d-47bd-a3d1-fad20fb1de08'''
\set sh091082 '''7dd37314-3028-4356-a433-b43016896cd6'''
\set sh270351 '''5b416079-1c62-4c4e-8e27-d22e4ed6a3bd'''
\set kakao '''743b72e5-064b-48fb-99d2-b986badb54b3'''
\set naver '''aba4ac7b-f73a-436e-a403-cd8de5702598'''

BEGIN;

-- 토스뱅크: 본인 자산 이동
UPDATE transactions
   SET category = 'self_transfer'
 WHERE channel_id = :toss
   AND category IS NULL
   AND (
        description = '최종혁'
     OR description LIKE '최종혁(인텔리이펙트%'
     OR description = '카카오페이'
     OR description = '네이버페이충전'
     OR description = '토스페이 충전'
     OR description LIKE '%토스증권%'
     OR description LIKE 'KB국민%'
   );

-- 신한 091082: 본인 자산 이동
UPDATE transactions
   SET category = 'self_transfer'
 WHERE channel_id = :sh091082
   AND category IS NULL
   AND (
        description IN ('최종혁','토뱅 최종혁','토스 최종혁')
     OR description LIKE '최종혁(인텔리이펙트%'
     OR description LIKE '%토스증권%'
   );

-- 신한 270351 (사업용): 법인↔개인 이체
UPDATE transactions
   SET category = 'self_transfer'
 WHERE channel_id = :sh270351
   AND category IS NULL
   AND description IN ('최종혁','토뱅 최종혁');

-- 카카오페이: 카카오 ↔ 토스
UPDATE transactions
   SET category = 'self_transfer'
 WHERE channel_id = :kakao
   AND category IS NULL
   AND description LIKE '%최종혁%';

-- 네이버페이: 네이버 ↔ 토스 충전
UPDATE transactions
   SET category = 'self_transfer'
 WHERE channel_id = :naver
   AND category IS NULL
   AND description LIKE '토스뱅크%';

-- 카드대금 (이중계산 방지)
UPDATE transactions
   SET category = 'card_payment'
 WHERE category IS NULL
   AND (
        (channel_id = :toss     AND description IN ('현대카드','신한카드','삼성카드'))
     OR (channel_id = :sh091082 AND description = '신한카드')
   );

COMMIT;

-- 결과 요약
SELECT category, COUNT(*) AS cnt, SUM(amount) AS total
  FROM transactions
 WHERE category IN ('self_transfer','card_payment')
 GROUP BY category;
