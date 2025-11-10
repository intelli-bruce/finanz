# Repository Guidelines
Finanz monorepo는 financial markdown과 웹 시각화를 다룹니다.

## Project Structure & Module Organization
- `api/`는 Express + TypeScript 기반 REST API이며 `src/`에 라우터·Supabase client, `dist/`에 빌드 산출물이 위치합니다.
- `web/`은 Vite + React 19 UI로 core 코드는 `web/src`, 정적 자산은 `web/public`입니다.
- `mcp/`는 Claude MCP server 엔트리로 tool 선언은 `src/`, 배포물은 `dist/index.js`입니다.
- `data/financial.md`는 싱글소스 재무 데이터, `data/transactions/`는 CSV ingest 결과 JSON, `data/uploads/`는 임시 캐시이므로 민감 데이터는 Git에 포함하지 마세요.

## Build, Test, and Development Commands
- `npm install` : 모든 workspace 의존성 설치.
- `npm run dev` : API(3002)+Web(5173) hot reload.
- `npm run dev:api` / `npm run dev:web` : 서비스별 단독 실행.
- `npm run build` / `npm run build:api|web` : TypeScript 빌드.
- `npm run start:api` : 프로덕션 모드 API.
- `npm run lint --workspace=web` : React ESLint, MCP는 `npm run build --workspace=mcp`.
- `npm run ingest:transactions -- <csv> [--out ...] [--tz +09:00]` : CSV를 `data/transactions/*.json`으로 변환해 `/transactions` 및 MCP에 공급.
- `npm run ingest:coupang -- --out <path> <pdf...>` : 쿠팡 카드 영수증 PDF를 `data/transactions/coupang/*.json`으로 변환합니다.

## Coding Style & Naming Conventions
- TypeScript, 2-space indent, 세미콜론, `const` 우선이 기본이며 React component는 PascalCase, hooks/util은 camelCase, API 라우트는 kebab-case입니다.
- ESLint(Flat config)와 TypeScript strict 옵션을 통과해야 PR 검토가 진행됩니다.

## Testing Guidelines
- 공식 test script는 없어도 새 기능엔 unit test를 붙여야 합니다.
- Web은 `Vitest + React Testing Library`, API는 `Vitest + supertest`로 `src/__tests__/` 를 구성합니다.
- 파일 IO·Supabase 로직은 mock boundary를 두고 happy-path/예외 입력 모두 검증하며 lint → build → test 로그를 PR 본문에 남깁니다.

## Commit & Pull Request Guidelines
- Git 기록은 `feat: …`, `docs: …` 형태의 Conventional Commits를 사용합니다. scope가 필요하면 `feat(api): …`처럼 명시하세요.
- 커밋은 하나의 기능 단위(코드 + 스키마 + 문서)를 완결해야 하며, noisy 파일(`dist/`, `.env`)은 포함하지 않습니다.
- PR 본문에는 문제 배경, 변경 요약, 테스트 로그, UI 영향 스크린샷(해당 시), 관련 Issue/Task 링크를 포함하세요.
- Reviewer가 쉽게 재현하도록 필요한 `.env` 키나 Supabase bucket 세팅을 체크리스트로 정리합니다.

## Security & Configuration Tips
- `api/.env`에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PORT`를 채우고 업로드 캐시는 항상 `.gitignore`.
- MCP 실행 시 `FINANZ_API_URL`과 Claude Desktop config(~/Library/Application Support/Claude/claude_desktop_config.json)을 README와 동일하게 유지합니다.
- Node 18 / npm 9 이상에서 `npm outdated` 결과를 공유하고 의존성 범위를 갱신하세요.

## API & MCP Notes
- `GET /transactions`는 최신(또는 `file` 지정) JSON을 날짜·유형·검색어·금액으로 필터링합니다. `file` 값은 `data/transactions/` 기준 상대 경로(`tossbank/2025-01-01_2025-11-10.json`)를 사용하세요.
- MCP `list_transactions` tool 역시 같은 API를 호출하므로 필요한 파라미터만 넘겨 토큰 사용을 최소화하세요.
