# Snipsik 상세 사양서 (Specification)

## 1. 개요 및 핵심 원칙

- **런타임**: Bun (v1.x)
- **개발 언어**: TypeScript (Strict Mode 활성화, `any` 타입 사용 일절 금지)
- **모듈 경로**: `@/*` Alias를 통한 100% 절대 경로 import 사용 (`src/` 디렉터리 기준)
- **UI 표준**: 모든 메시지, 대시보드, 알림에 **Discord Components v2** 레이아웃 전면 적용
- **백엔드 연동**: Sink REST API (`Authorization: Bearer <NUXT_SITE_TOKEN>`)
- **AI 배제**: `/api/link/ai`, `/api/link/og-ai` 등 AI 엔드포인트는 일절 호출하지 않음
- **데이터베이스 역할 제한**:
  - 링크와 슬러그 매핑 데이터는 DB에 저장하지 않음 (Sink API 자체 관리 및 슬러그 규칙으로 소유권 검증)
  - Supabase PostgreSQL + Drizzle ORM은 **설정(Config) 및 Watch 채널 목록** 저장용으로만 사용

---

## 2. 슬러그(Slug) 생성 및 유저 분리 엔진

### 2.1 유저 해시 생성 알고리즘

1. 디스코드 유저의 Snowflake ID (예: `294123456789012345`)를 문자열로 수신.
2. 32-bit CRC32 (또는 FNV-1a) 해시 알고리즘을 적용하여 32비트 부호 없는 정수(Unsigned Int) 계산.
3. 이를 Base36(`0-9`, `a-z`) 문자열로 인코딩하여 32비트 해시 값을 일대일(Injective) 대응하는 **7글자의 고유 유저 해시**(`userHash`) 생성. (Sink 백엔드의 소문자 슬러그 강제 정규화 정책과 완전 호환되며 대소문자 변환으로 인한 인공 충돌 방지, 예: `021i3v9`, `1t4x77h`)

### 2.2 슬러그 포맷

- **일반 링크 생성 (`/link create` 및 자동 단축)**:
  - 포맷: `{랜덤 문자열}-{유저 해시}` (전부 소문자)
  - 랜덤 문자열 길이: `.env`의 `RANDOM_SLUG_LENGTH` (기본값: `3`)
  - 예시: `k9p-021i3v9` (총 11글자 내외의 컴팩트한 길이)
- **커스텀 슬러그 생성 (`/link custom`)**:
  - 포맷: `{지정한 커스텀 슬러그}`
  - 권한: `.env`의 `ADMIN_USER_IDS`에 등록된 관리자 유저만 생성 가능.

### 2.3 링크 소유권 검증 로직

- 링크 조회/수정/삭제/통계 조회 시:
  1. 관리자 유저(`ADMIN_USER_IDS`)는 모든 링크 조작 가능.
  2. 일반 유저는 대소문자 구분 없이 슬러그의 끝부분이 본인의 `userHash`와 일치하는지 검사 (`slug.toLowerCase().endsWith("-" + userHash.toLowerCase())` 또는 동일 여부).
  3. 불일치 시 접근 거부 및 권한 부족 안내 반환.

---

## 3. 슬래시 커맨드 상세 명세

모든 링크 관련 명령어는 최상위 `/link` 아래의 서브커맨드로 구성됩니다.

### 3.1 `/link` 서브커맨드 및 서브커맨드 그룹

| 명령어                 | 매개변수                                                                                                                                               | 설명                                                        | 권한                            |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- | :------------------------------ |
| `/link dashboard`      | 없음                                                                                                                                                   | 유저 개인 전용 일시성(Ephemeral) 인터랙티브 대시보드 열기   | 전체 유저                       |
| `/link config`         | `key` (선택, Autocomplete)<br>`value` (선택, Autocomplete)                                                                                             | 개인별 URL 감시 오버라이드 및 DM 메시지 포맷 설정 조회/변경 | 전체 유저                       |
| `/link create`         | `url` (필수)<br>`expiration` (선택, 초/분/시간 단위)<br>`password` (선택)<br>`tag` (선택)<br>`title` (선택)<br>`description` (선택)<br>`unsafe` (선택) | 일반 단축 링크 생성 (`{랜덤N}-{유저해시}`)                  | 전체 유저                       |
| `/link custom`         | `url` (필수)<br>`custom_slug` (필수)<br>기타 옵션 동일                                                                                                 | 순수 커스텀 슬러그 링크 생성                                | `ADMIN_USER_IDS` 등록 유저 전용 |
| `/link list`           | `tag` (선택)<br>`page` (선택, 기본 1)                                                                                                                  | 본인의 `userHash`가 포함된 생성 링크 목록 조회              | 전체 유저 (본인 링크만)         |
| `/link stats`          | `slug` (필수)                                                                                                                                          | 특정 슬러그의 클릭 수 및 방문 통계 조회                     | 본인 소유 링크 또는 관리자      |
| `/link delete`         | `slug` (필수)                                                                                                                                          | 단축 링크 영구 삭제                                         | 본인 소유 링크 또는 관리자      |
| `/link check`          | `url` (필수)                                                                                                                                           | 대상 웹사이트의 생존 여부(HTTP 상태코드) 헬스체크           | 전체 유저                       |
| `/link watch add`      | `channel` (필수)                                                                                                                                       | 해당 채널을 URL 감시 대상에 추가                            | 서버 관리자 (`ManageGuild`)     |
| `/link watch remove`   | `channel` (필수)                                                                                                                                       | 해당 채널을 URL 감시 대상에서 제거                          | 서버 관리자 (`ManageGuild`)     |
| `/link watch list`     | 없음                                                                                                                                                   | 현재 서버의 감시 대상 채널 목록 조회                        | 서버 관리자 (`ManageGuild`)     |
| `/link admin overview` | 없음                                                                                                                                                   | Sink 인스턴스 전체 링크/클릭 종합 현황 및 TOP 5 링크 조회   | 봇 관리자 (`ADMIN_USER_IDS`)    |
| `/link admin list`     | `tag` (선택)<br>`query` (선택, 검색어)<br>`page` (선택, 기본 1)                                                                                        | 인스턴스의 모든 단축 링크 목록 검색 및 페이징 조회          | 봇 관리자 (`ADMIN_USER_IDS`)    |
| `/link admin user`     | `user` (필수)<br>`tag` (선택)<br>`page` (선택, 기본 1)                                                                                                 | 특정 대상 유저가 생성한 링크 목록 조회                      | 봇 관리자 (`ADMIN_USER_IDS`)    |
| `/link admin delete`   | `slug` (필수)                                                                                                                                          | 소유권과 무관하게 지정한 슬러그 링크 강제 영구 삭제         | 봇 관리자 (`ADMIN_USER_IDS`)    |

---

## 4. 유저 개인 전용 대시보드 (`/link dashboard`)

- **비공개 일시성(Ephemeral)**:
  - 오직 명령어를 입력한 유저 본인에게만 표시되며 다른 유저에게 노출되지 않음.
- **개인 통계 요약 (Components v2)**:
  - 내 단축 링크 총 개수
  - 활성(Active) 링크 수 / 만료(Expired) 링크 수
  - 내 링크들의 누적 총 클릭 수
- **인터랙티브 컴포넌트**:
  - ➕ **[새 링크 생성] 버튼**: 클릭 시 URL, 만료일, 비밀번호 등을 입력할 수 있는 Discord Modal 팝업 호출.
  - 📋 **[내 링크 선택] Select Menu**: 최근 생성한 내 링크 목록 드롭다운 (선택 시 해당 링크 상세 정보 카드로 전환).
  - ✏️ **[링크 수정] 버튼**: 선택된 링크의 타겟 URL, 비밀번호, 만료일 수정 Modal 호출.
  - 🗑️ **[링크 삭제] 버튼**: 확인 팝업 후 즉시 삭제.
  - 🔄 **[새로고침] 버튼**: 대시보드 통계 및 목록 갱신.
  - ⚙️ **[설정] 버튼**: 개인 설정 전용 패널(`Config Panel`)로 화면 전환.
- **개인 설정 패널 (`Config Panel` / `/link config`)**:
  - `auto_dm` (자동 DM 수신 모드): `inherit` (서버 설정 따름, 기본값) / `on` (모든 채널에서 항상 켬) / `off` (항상 끔) 원클릭 토글.
  - `dm_format` (DM 메시지 포맷): `replace` (본문 치환, 기본값) / `list` (단축 URL 목록 나열) 원클릭 토글.
  - `[📊 대시보드로 이동]` 버튼을 통해 언제든지 메인 대시보드로 복귀 가능.

---

## 5. 채널 감시(Watcher) 및 유저 오버라이드 / DM 발송 규격

### 5.1 감시 흐름 및 유저 오버라이드 결정

1. `messageCreate` 이벤트 수신.
2. 봇 자신의 메시지이거나 웹훅인 경우 무시.
3. 대상 채널이 `watch_channels`에 등록되어 있는지(`isChannelWatched`) 확인.
4. 작성자 유저의 `autoDmMode` 삼태(Tri-state) 개인 설정 검사 (`userConfigService.shouldProcessUser`):
   - `off`: 서버 감시 채널 여부와 무관하게 DM 발송 스킵.
   - `on`: 서버 감시 채널 등록 여부와 무관하게 봇이 접근 가능한 모든 채널에서 자동 감시 진행.
   - `inherit` (기본값): 서버 감시 채널(`isChannelWatched === true`)일 때만 진행.
5. 메시지 본문에서 정규식(`https?://[^\s]+`)으로 유효 긴 URL 추출.
6. 작성자의 `userHash`를 부착한 슬러그로 Sink API에 단축 링크 생성 요청.
7. 작성자의 **Discord DM**으로 2단계 포맷 메시지 발송.

### 5.2 DM 메시지 전송 포맷

1. **1차 메시지 (Components v2 카드)**:
   - 원본 긴 URL 목록, 발송된 원본 메시지 링크(`message.url`), 생성 시각을 포함한 인터랙티브 안내 UI 카드.
2. **2차 메시지 (유저의 `dmFormat` 설정에 따른 분기)**:
   - **`replace` 모드 (기본값)**: 원본 메시지 텍스트 본문에서 긴 URL들만 생성된 단축 URL로 정밀 치환한 완성형 본문 전송 (2,000자 초과 시 자동 분할 전송).
   - **`list` 모드 (레거시/목록형)**: `<>` 기호나 기타 텍스트 없이 단축 URL 문자열만을 순차 전송 (모바일 Long-press 복사 최적화).
