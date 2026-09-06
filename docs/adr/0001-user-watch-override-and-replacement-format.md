# User Watch Override and Message Replacement Format

## Status

Accepted

## Context

기존 Snipsik은 서버 관리자가 등록한 감시 채널(`watch_channels`)에 대해서만 동작하고, 모든 사용자에게 고정된 URL 목록 형태로만 DM을 발송했습니다. 사용자가 서버 설정과 무관하게 자신의 URL 감시 여부(ON/OFF)를 직접 통제하고, 단순 URL 나열 대신 원본 메시지 문맥에서 URL만 교체된 완성형 텍스트를 받길 원하는 요구가 발생했습니다.

## Decision

1. 유저 오버라이드 `on`의 적용 범위를 서버 감시 채널에 국한하지 않고 봇이 접근 가능한 모든 채널 전역(Global Scope)으로 정의하고, 미설정 사용자의 기본값은 기존 서버 감시 채널을 따르는 `inherit` 삼태(Tri-state)로 결정했습니다.
2. DM 본문의 기본 포맷을 원본 메시지 텍스트에서 긴 URL을 단축 URL로 정밀 치환하는 `replace` 모드로 설정하고, 기존 URL 나열(`list`) 방식은 설정 가능하도록 유지했습니다.
3. `/link config` 슬래시 커맨드(key/value Discord Autocomplete 지원)와 `/link dashboard` 대시보드 내 ⚙️ 설정 버튼이 동일한 인터랙티브 `Config Panel` 컴포넌트 뷰를 공유하도록 단일화했습니다.

## Consequences

- $O(1)$ 빠른 메시지 필터링을 위해 `UserConfigService` 인메모리 캐시를 유지해야 합니다.
- 유저가 `on`으로 설정하면 서버에 감시 채널이 등록되지 않았더라도 해당 유저가 작성한 URL에 대해 정상적으로 단축 및 DM 발송이 수행됩니다.
- 본문 치환 시 URL 부분 문자열 오치환 방지를 위해 URL 길이 내림차순(longest-first) 치환 알고리즘이 적용됩니다.
