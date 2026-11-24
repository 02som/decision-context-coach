# Jira 입력 필드 명세

**관련 WBS ID:** 3.1

**담당자:** 박경서

**작성일:** 2026-11-24

**상태:** 확정 (2026-11-25, 팀장 확인)

**관련 Jira 작업:** DFAS-151

## 1. 목적

AI(Groq)에 넣을 Jira 이슈 입력 필드와 Jira 출처(매핑)를 정한다. API Contract v0.2.0(DFAS-124) 2절이 `key`, `summary`, `description` 세 필드를 제안하고 "최종 매핑은 DFAS-151에서 확정"하도록 정했다.

AI 입력의 목적 (근거: API Contract v0.2.0 3~5절)

1. Decision Card: `decision`(결정), `risk`(위험), `technicalConsiderations`(기술적 고려 사항), `missingInformation`(확인 불가 정보)을 작성
2. 기술 질문: Decision Card와 관련된 `question` 하나 생성
3. 답변 평가: 같은 정규화된 이슈를 받아 답변을 평가. 평가의 근거(evidence)는 Jira 이슈와의 연결이며, AI 분석은 근거가 아니다 (4·5절)

백엔드 분석 프롬프트는 "제공된 Jira 이슈의 제목과 설명을 사실 근거로 사용", "근거가 되는 Jira 문구를 인용", "확인되지 않은 정보는 '확인 불가'로 표시"하도록 지시한다. 따라서 이 입력이 분석과 평가에서 AI가 아는 사실의 전부다.

## 2. 요구사항 및 작업 범위

- 완료 기준: AI 입력에 사용할 필드 명세
- API Contract v0.2.0(DFAS-124) 2절 요구사항: 세 필드 모두 문자열 / 설명이 없으면 `""` / `key`·`summary`가 없으면 오류 / 필드 임의 추가 금지
- 범위: 세 필드의 Jira 출처와 원래 형태, 없을 때의 처리, 추가 필드 검토
- 범위 밖: 정규화 규칙과 구현(DFAS-152), 테스트 이슈(DFAS-153)

## 3. 상세 설계

### 3.1 Jira 필드 전체와 선택

Jira Cloud 기본 필드 기준. 팀 사이트의 사용자 정의 필드는 확인하지 못했다. "결정 카드 기여"는 [판단]이다.

| 필드 | API 이름 | 담기는 내용 | 결정 카드 기여 | MVP 선택 |
|---|---|---|---|---|
| 이슈 번호 | `key` | 예: DFAS-151 | 식별용 | ✓ |
| 제목 | `summary` | 무슨 일인지 | 높음 | ✓ |
| 설명 | `description` | 배경, 목표, 결정 | 높음 | ✓ |
| 댓글 | `comment` | 진행 중 결정, 논의 | 높음 | MVP 제외 |
| 이슈 유형 | `issuetype` | 작업/버그/스토리 | 중간 (맥락) | MVP 제외 |
| 상위 이슈 | `parent` | 속한 큰 작업 | 중간 (맥락) | MVP 제외 |
| 연결된 이슈 | `issuelinks` | 선후 관계 | 중간 | MVP 제외 |
| 라벨 | `labels` | 태그 | 낮음~중간 | MVP 제외 |
| 컴포넌트 | `components` | 기능 영역 | 낮음~중간 | MVP 제외 |
| 상태 | `status` | 할 일/진행 중/완료 | 낮음 | ✗ |
| 우선순위 | `priority` | 높음/낮음 | 낮음 | ✗ |
| 담당자·보고자·작성자 | `assignee`, `reporter`, `creator` | 사람 | 없음, 개인정보 | ✗ |
| 날짜 | `created`, `updated`, `duedate` 등 | 생성·수정·마감일 | 없음 | ✗ |
| 첨부 | `attachment` | 파일 | AI가 읽지 못함 | ✗ |
| 하위 작업 | `subtasks` | 쪼갠 작업 | 낮음 | ✗ |
| 작업 기록·시간 | `worklog`, `timetracking` | 시간 | 없음 | ✗ |
| 버전·환경 | `fixVersions`, `versions`, `environment` | 출시 버전 등 | 낮음 | ✗ |

"결정 카드 기여"의 근거: Decision Card 필드별로 필요한 재료 [판단]

| Decision Card 필드 | 필요한 재료 |
|---|---|
| `decision` | 설명, 댓글 |
| `risk` | 설명, 댓글 |
| `technicalConsiderations` | 설명, 댓글 |
| `missingInformation` | 재료가 빈약할수록 길어짐 |
| `question` | 위 넷의 품질에 달림 |

- MVP는 API Contract v0.2.0(DFAS-124)의 세 필드만 쓰고, 나머지 필드는 모두 이번 MVP에서 제외한다 (2026-11-25 팀장 확인)

### 3.2 선택한 필드의 매핑

| 계약 필드 | Jira 출처 (REST API v3) | Jira 원래 형태 | 없을 때 |
|---|---|---|---|
| `key` | `key` | 문자열 (예: `DFAS-151`) | 오류 |
| `summary` | `fields.summary` | 문자열 | 오류 |
| `description` | `fields.description` | ADF (서식 구조 JSON) | `""` |

- 세 필드는 Jira 필드와 1대1로 매핑한다
- `description`은 ADF로 오므로 일반 텍스트 변환이 필요하다 → 규칙은 DFAS-152
- 세 필드로 Decision Card(특히 `decision`, `technicalConsiderations`)를 충분히 채울 수 있는지는 **미검증**이다. 설명에 결정과 이유가 적혀 있으면 충분하고, 아니면 부족하다. DFAS-153/154 결과로 판단하고, 부족하면 5절 변경 제안의 근거로 쓴다

## 4. 예시 및 검증 결과

Jira 응답(필요한 부분만) → AI 입력:

```json
{ "key": "DFAS-999",
  "fields": { "summary": "로그인 방식 결정",
              "description": { "type": "doc", "version": 1, "content": [ … ] } } }
```

```json
{ "key": "DFAS-999", "summary": "로그인 방식 결정", "description": "(DFAS-152 규칙으로 변환한 텍스트)" }
```

- 현재 코드는 분석(`analyzeIssue`)과 평가(`loadIssueForEvaluation`) 두 곳에서 모두 `fields=summary,description`으로 같은 두 필드를 조회한다 (`src/resolvers/jira-issue-panel.js`, 확인 기준: `main` `45b39de`)

## 5. 결정 사항 및 미해결 문제

**결정 사항 (API Contract v0.2.0 2절 그대로, 2026-11-25 팀장 확인 · DFAS-151 댓글)**

- 세 필드(`key`, `summary`, `description`)를 Jira 필드와 1대1로 매핑한다 (3.2절)
- MVP 입력은 이 세 필드만 쓴다. 댓글 등 다른 필드는 이번 MVP에서 제외한다
- 산출물은 GitHub `docs` 폴더에서 관리하고 Jira에 링크한다

**변경 제안 (조건부) → 이번 MVP에서 제외로 결정 (팀장 확인)**

- 제안: DFAS-153/154에서 `decision`·`technicalConsiderations`가 '확인 불가'로 채워지는 경우가 많으면, **사람이 쓴 댓글**을 AI 입력에 추가한다
- 근거: 앱은 제목·설명만 사실 근거로 쓰는데(1절), 작업 중 내린 결정과 이유는 설명보다 댓글에 적히는 경우가 많다 [판단]
- 추가할 때 얻는 것: `decision`·`technicalConsiderations`의 재료가 늘어난다
- 추가할 때 드는 비용
  - API Contract: 2절 수정과 분석·평가 담당 합의 필요
  - 구현: 댓글 추가 조회, 앱이 남긴 댓글 걸러내기 (AI가 자기 이전 출력을 근거로 재사용하는 문제)
  - 한도: 입력 토큰 증가 (Groq 분당 8,000 토큰, DFAS-152 문서 4절)
  - 개인정보: 작성자·멘션 등 사람 정보 증가
  - 마감: 11/27 MVP 전에는 어렵다 [판단] → 그래서 조건부로 제안한다

**미해결**

- 없음

## 6. 완료 기준

- [x] 요구사항 충족
- [x] 검토 가능한 산출물 작성
- [x] 관련 담당자 검토
- [ ] Jira 산출물 링크 연결 (GitHub `docs` 링크, PR 병합 후)

## 7. 변경 이력

| 날짜 | 변경 내용 | 작성자 |
| --- | --- | --- |
| 2026-11-24 | 최초 작성 | 박경서 |
| 2026-11-25 | 정규화 규칙을 DFAS-152 문서로 분리, API Contract 명칭 통일 | 박경서 |
| 2026-11-25 | Jira 필드 전체 목록과 선택 근거 추가, 세 필드 충분성 미검증 명시 | 박경서 |
| 2026-11-25 | Decision Card 정의를 API Contract 3절 기준으로 수정, 필드별 재료 표 추가 | 박경서 |
| 2026-11-25 | API Contract v0.2.0 기준으로 수정 (평가 근거, 백엔드 프롬프트, 조회 위치) | 박경서 |
| 2026-11-25 | 5절을 결정 사항(계약 확인)과 변경 제안(댓글 추가, 조건부)으로 분리 | 박경서 |
| 2026-11-25 | 팀장 확인으로 확정: 세 필드 유지, 추가 필드 MVP 제외, 산출물 GitHub docs 관리 | 박경서 |
| 2026-11-25 | 필드 표의 '검토 후보'를 'MVP 제외'로 정리 | 박경서 |
