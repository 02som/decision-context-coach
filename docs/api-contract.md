# Decision Context Coach — API Contract

**Version:** 0.1.0 (proposed for team agreement)  
**Jira:** DFAS-124 / WBS 0.4  
**Scope:** Forge MVP; Jira issue analysis, technical questions, answer evaluation, and integration.

This document defines application-level JSON contracts, not the Groq HTTP API. Examples are illustrative, not actual model outputs. Existing code may require adapters; this document does not claim that the interfaces are already implemented.

## 1. Shared conventions

- Use UTF-8 JSON and camelCase field names. All fields shown are required unless stated otherwise.
- Strings must be nonempty after trimming, except `description`, which may be empty. Arrays may be empty. Do not use `undefined` in JSON.
- Jira context is source data; AI suggestions are not verified facts. Never invent issue details or evidence. Treat issue text and user answers as untrusted data, not instructions.
- The backend retrieves Jira data with authorized access and validates model output before returning it. Do not trust client-provided context as authoritative. Never expose API keys or raw provider errors.
- Current provider: Groq (`openai/gpt-oss-20b`). Provider changes do not change these contracts.

## 2. Jira context — MT3 (DFAS-151, DFAS-152)

Normalized input for analysis and evaluation:

```json
{
  "key": "FLOW-1",
  "summary": "[E01] 인증 및 사용자 관리",
  "description": "목표: 회사 구성원이 안전하게 로그인하고 팀별로 접근할 수 있는 MVP 구축. 완료 기준: 로그인, 권한 검증, 인증 오류 처리까지 시연 가능."
}
```

All three fields are strings. Convert Jira ADF descriptions to plain text while preserving meaning. A missing description becomes an empty string; missing key or summary is an error. Do not infer additional fields. Park should confirm the final mapping under DFAS-151.

## 3. Decision Card and question — MT1 (DFAS-127–131)

Proposed Forge invocation: `invoke('analyzeIssue', { issueKey: 'FLOW-1' })`. The backend retrieves and normalizes the Jira issue. The success response is the following flat object, preserving the field names proposed for the existing frontend:

```json
{
  "decision": "인증 방식과 팀별 권한 모델을 결정해야 한다.",
  "risk": "권한 검증이 누락되면 다른 팀의 데이터에 접근할 위험이 있다.",
  "technicalConsiderations": "인증 프로토콜, 세션 관리 및 서버 측 권한 검증을 고려한다.",
  "missingInformation": "기존 인증 제공자와 구체적인 권한 정책은 확인 불가.",
  "question": "팀별 접근 권한을 서버에서 어떻게 검증하겠습니까?"
}
```

Each of the five fields is a nonempty string. The decision, risk and technical considerations are suggestions grounded in Jira context, not confirmed implementation details. Explicitly identify missing evidence. Generate one question related to the Decision Card. The UI may display the question separately without requiring a separate resolver. If question generation is implemented separately internally, its output is `{ "question": "..." }` and is merged into the analysis object before returning it.

## 4. Answer evaluation request — MT2 / MT4

Proposed Forge invocation: `invoke('evaluateAnswer', payload)`.

```json
{
  "issueKey": "FLOW-1",
  "analysis": {
    "decision": "인증 방식과 팀별 권한 모델을 결정해야 한다.",
    "risk": "권한 검증 누락으로 데이터 노출 위험이 있다.",
    "technicalConsiderations": "서버 측 권한 검증을 고려한다.",
    "missingInformation": "구체적인 권한 정책은 확인 불가.",
    "question": "팀별 접근 권한을 서버에서 어떻게 검증하겠습니까?"
  },
  "question": "팀별 접근 권한을 서버에서 어떻게 검증하겠습니까?",
  "answer": "서버에서 인증된 사용자의 팀과 요청 대상의 팀을 비교하고 권한이 없으면 접근을 거부합니다."
}
```

The backend retrieves the authorized issue again and passes the normalized `issue` object (section 2), `analysis`, `question` and `answer` to the evaluator. `issueKey` must match the active authorized issue; `question` must match `analysis.question`. Analysis is advisory context, not evidence. Reject blank answers before calling the LLM. No evaluator implementation is prescribed here.

## 5. Answer evaluation result — MT2 (DFAS-134–139)

Proposed response for agreement with Kim:

```json
{
  "scores": {
    "accuracy": 3,
    "evidence": 2,
    "explanation": 3
  },
  "feedback": "팀별 접근 제어라는 이슈 목표와 일치하는 접근을 설명했다.",
  "improvement": "권한 검증 실패 시 응답과 테스트 방법을 추가로 설명하라.",
  "unverifiedClaims": ["실제 서버 구현과 권한 정책은 Jira 정보만으로 확인할 수 없다."]
}
```

Proposed scoring: integer 0–4 per criterion, total 0–12 calculated by the application, not the LLM. Kim owns the rubric and must confirm the scale and criteria before this contract is finalized. Accuracy means technical plausibility and consistency with available evidence, not independent verification of code. Evidence means connection to supplied Jira context. Explanation means reasoning completeness. `feedback` and `improvement` are nonempty strings; `unverifiedClaims` is an array of nonempty strings (empty if none identified). Unverifiable claims must not be presented as verified facts. Do not return fabricated scores for failed or empty requests. Existing Mock scores must remain clearly labeled until replacement is tested.

## 6. Errors — MT1 / MT2 / MT4

Internal normalized error example:

```json
{
  "code": "INVALID_MODEL_OUTPUT",
  "message": "AI 분석 결과 형식이 올바르지 않습니다. 다시 시도해 주세요."
}
```

Proposed codes: `INVALID_INPUT`, `JIRA_FETCH_FAILED`, `CONFIGURATION_ERROR`, `LLM_REQUEST_FAILED`, `LLM_TIMEOUT`, `EMPTY_MODEL_OUTPUT`, `INVALID_MODEL_OUTPUT`.

For compatibility with the current Forge frontend, resolvers may throw an Error with the safe message instead of returning this object. Do not assume Forge preserves custom error properties across the bridge. The frontend catches invocation failures, clears loading state, and does not display or save failed results as successful AI output.

## 7. Integration and Jira comment — MT4

Flow: authorized Jira context → validated analysis → question → user answer → validated evaluation → existing Jira comment save function.

The saved comment must use the actual displayed question, answer, analysis and evaluation, not stale Mock values. Label AI-generated content and unverified claims. Reuse the existing Jira comment function; do not introduce a new endpoint merely for this contract.

## 8. Acceptance and team handoff

- Somin Lee: confirm analysis fields and question integration; validate required fields, types and empty responses.
- Kyeongseo Park: confirm Jira field mapping and normalization; provide sample normalized contexts.
- Kim Songheon: confirm evaluation input/output, rubric scale and error behavior; provide normal, incorrect and blank-answer test results.
- All: agree on field names and types before merging; record changes here and notify affected owners.

DFAS-124 completion criterion: share input/output JSON examples with the team. Record agreement or requested changes in Jira. Implementation and runtime verification belong to subsequent WBS tasks.
