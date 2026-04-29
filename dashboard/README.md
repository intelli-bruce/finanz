# finanz Dashboard

정적 HTML + Chart.js 기반 1페이지 대시보드.

## 사용법

```bash
# 1. DB → data.json 생성
python3 dashboard/generate-data.py

# 2. 정적 서버 실행 (CORS 회피)
python3 -m http.server 8080 --directory dashboard

# 3. 브라우저에서 열기
open http://localhost:8080
```

## 표시 항목
- 채널별 잔액 / 월 고정의무 / 월 활성 구독 / 3개월 예상 입금
- 월별 외부 현금흐름 (수입/지출/순)
- 향후 receivables 캘린더 + 월별 confidence별 누적
- 다음 고정의무 결제일
- 활성 구독 목록
- 4월 카테고리별 지출
- 무결제 / 만료 알림

## 데이터 소스
- `transactions` + `match_id` + `category` (외부거래 필터)
- `recurring_obligations`
- `subscriptions`
- `receivables`

`generate-data.py`는 매번 실행하면 최신 DB 상태로 갱신됩니다 (`data.json` 덮어쓰기).
