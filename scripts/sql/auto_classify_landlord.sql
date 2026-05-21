-- bruce-wealth-os: 박현주(사무실 임대인) 자동 분류 룰
-- 매번 import 후 실행하면 신규 박현주 거래도 자동으로 office_rent 분류 + obligation 연결.
-- 향후 임대인이 바뀌면 metadata.landlord_payee_pattern 업데이트.

BEGIN;

-- 사무실 임대 obligation의 metadata에 자동 매칭 패턴 명시 (정합성용)
UPDATE recurring_obligations
   SET metadata = metadata || jsonb_build_object(
        'auto_classify', jsonb_build_object(
          'channel_id',          '5b416079-1c62-4c4e-8e27-d22e4ed6a3bd',
          'description_patterns', ARRAY['박현주','토스 박현주','주거통신'],
          'rent_amounts',         ARRAY[2700000, 270000],
          'note',                 '매월 13일 본금 2.7M + 부가세 270K. 그 외 큰 송금은 보증금/일회성으로 분류.'
        )
       ),
       updated_at = now()
 WHERE id = 'aa759f71-5b07-49fd-9e11-9f589abd5e95';

-- 신규 거래 자동 매칭
-- 1) 매월 정기 임대료 (2.7M + 270K) → office_rent
UPDATE transactions
   SET obligation_id = 'aa759f71-5b07-49fd-9e11-9f589abd5e95',
       category = 'office_rent'
 WHERE channel_id = '5b416079-1c62-4c4e-8e27-d22e4ed6a3bd'
   AND amount < 0
   AND obligation_id IS NULL
   AND ((description ~ '박현주|주거통신') AND ABS(amount) IN (2700000, 270000));

-- 2) 박현주 그 외 송금 (보증금/이사 일회성) → office_deposit
UPDATE transactions
   SET obligation_id = 'aa759f71-5b07-49fd-9e11-9f589abd5e95',
       category = 'office_deposit'
 WHERE channel_id = '5b416079-1c62-4c4e-8e27-d22e4ed6a3bd'
   AND amount < 0
   AND obligation_id IS NULL
   AND description ~ '박현주';

COMMIT;

-- 결과
SELECT category, COUNT(*) AS cnt, SUM(ABS(amount))::int AS total
  FROM transactions
 WHERE obligation_id = 'aa759f71-5b07-49fd-9e11-9f589abd5e95'
 GROUP BY category;
