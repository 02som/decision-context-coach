# Bitbucket 연동 가능성 기술 조사

**관련 WBS ID:** 3.5

**담당자:** 박경서

**작성일:** 2026-11-26

**상태:** 완료 (MVP 미포함)

**관련 Jira 작업:** DFAS-155

## 1. 목적

Decision Context Coach(Jira용 Forge 앱)에 Bitbucket Cloud의 코드 정보(PR, 커밋)를 연동할 수 있는지 권한·API·난이도를 조사한다.

## 2. 요구사항 및 작업 범위

- 완료 기준 (WBS 3.5): 권한·API·난이도 요약, MVP 미포함
- 범위: 공식 문서와 Atlassian 이슈·커뮤니티 답변 조사 (확인일 2026-11-26)
- 범위 밖: 구현, 실제 호출 시험

## 3. 수행 내용

### 3.1 권한

- **한 Forge 앱에 Jira 권한과 Bitbucket 권한을 함께 넣을 수 없다.** 함께 넣고 배포하면 `Workspace scopes can not be used with site scopes` 오류가 난다. Atlassian이 안내한 우회 방법은 앱 ID가 다른 앱을 따로 만드는 것이다 ([ECO-329](https://jira.atlassian.com/browse/ECO-329))
- 여러 Atlassian 앱을 지원하는 Forge 공식 기능은 Jira·Confluence만 대상이고 Bitbucket은 해당하지 않는다 ([Forge 문서](https://developer.atlassian.com/platform/forge/migrating-a-forge-app-to-support-multiple-atlassian-apps/), 2026-10-30 갱신)
- 반대로 Bitbucket용 Forge 앱에서 Jira를 부르면 `Request jira is not allowed from bitbucket context.` 오류가 난다 ([ECO-223](https://jira.atlassian.com/browse/ECO-223))
- ECO-329·ECO-223은 2024년 등록 이슈로, 지금 상태는 위 공식 문서로만 확인했다

### 3.2 API

- Bitbucket Cloud REST API 2.0. Bitbucket용 Forge 앱은 `requestBitbucket`으로 호출하고 인증이 자동으로 붙는다 ([Forge 문서](https://developer.atlassian.com/platform/forge/apis-reference/fetch-api-product.requestbitbucket/)). Forge 앱 권한이 표시된 엔드포인트만 쓸 수 있다 ([Atlassian 답변](https://community.atlassian.com/forums/Forge-for-Bitbucket-Cloud/403-Forbidden-Calling-BitBucket-REST-API-in-Forge-App/td-p/2678694))
- 호출 한도: 저장소 데이터(`/2.0/repositories/*`)는 기본 시간당 1,000회 ([Bitbucket 문서](https://support.atlassian.com/bitbucket-cloud/docs/api-request-limits/))
- Forge 밖 방식의 인증: 앱 비밀번호는 2026-07-28에 완전히 없어져 API 토큰을 써야 한다 ([공지](https://community.atlassian.com/forums/Bitbucket-articles/Deprecation-notice-Bitbucket-Cloud-app-password-brownout/ba-p/3237429)). Forge 외부 인증(OAuth)은 Atlassian OAuth를 지원하지 않는다 ([Atlassian 답변](https://community.developer.atlassian.com/t/forge-external-oauth2-doesnt-support-atlassian-oauth/55283))

### 3.3 방법과 난이도

| 방법 | 내용 | 난이도 | 걸림돌 |
|---|---|---|---|
| A. 외부 API처럼 호출 | 지금 Jira 앱에서 Groq처럼 `api.bitbucket.org`를 호출, 인증은 Bitbucket API 토큰 | 중 | 토큰 보관(환경 변수), 시간당 1,000회, 사용자별 접근 권한 처리 |
| B. Bitbucket용 앱 분리 | Jira용·Bitbucket용 앱 2개 | 상 | 두 앱 사이 데이터 전달이 어렵다. Bitbucket 워크스페이스가 Atlassian 조직에 연결돼 있어야 Forge 앱을 쓸 수 있다 ([공지](https://community.atlassian.com/forums/Bitbucket-articles/Important-update-Bitbucket-Workspaces-need-to-be-linked-to-an/ba-p/3113190), 2026-03-16부터) |

- A가 가능하다는 정황: Bitbucket 커밋·PR·파이프라인을 Jira 이슈 패널에 보여 주는 Forge 앱이 마켓플레이스에 있다 ([Connector for Bitbucket and Jira](https://marketplace.atlassian.com/apps/1230574)). 구현 방식은 확인하지 못했다 [추정]

## 4. 예시 및 검증 결과

- 실제 호출은 시험하지 않았다 (범위 밖)

## 5. 결정 사항 및 미해결 문제

**결정 사항**

- MVP에 포함하지 않는다
- 연동한다면 A(외부 API처럼 호출)가 현실적이다 [판단]

**연동했을 때의 가치**

- 지금 분석 프롬프트는 "Jira에 기술명이 있어도 실제 코드에서 쓰는지 판단하지 않는다". 이슈 번호로 연결된 PR·커밋을 가져오면 Jira의 결정이 실제 코드에 반영됐는지까지 보여 줄 수 있다

**미해결**

- [ ] Jira 이슈의 "개발" 정보(연결된 브랜치·커밋·PR)를 Forge 앱이 공식 API로 읽을 수 있는지 확인하지 못함
- [ ] A 방식 실제 호출 시험

## 6. 완료 기준

- [x] 권한·API·난이도 요약
- [x] MVP 미포함 명시
- [ ] 관련 담당자 검토
- [ ] Jira 산출물 링크 연결 (PR 후)

## 7. 변경 이력

| 날짜 | 변경 내용 | 작성자 |
| --- | --- | --- |
| 2026-11-26 | 최초 작성 | 박경서 |
