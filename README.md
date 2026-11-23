# Decision Context Coach

**An AI-powered decision-support and technical reasoning coach for Jira issues.**

Decision Context Coach is an Atlassian Forge app built for **Codegeist 2026**. It helps developers examine the context behind a Jira issue, identify technical decisions and uncertainties, and practice explaining their reasoning through AI-generated questions.

> **Project status:** Active development / MVP. Some features are still rule-based mocks and should not be treated as AI-verified evaluations.

## What It Does

The app runs inside a Jira issue panel and is designed to support this workflow:

1. Read the current Jira issue's title and description.
2. Analyze the issue using an LLM and generate a **Decision Card**.
3. Present a technical question based on the issue context.
4. Accept the developer's answer.
5. Evaluate the answer and provide evidence-aware feedback (**AI evaluation is under development**).
6. Save the interaction to the Jira issue as a comment.

### Current Implementation

| Capability | Status |
| --- | --- |
| Jira issue context retrieval | Implemented |
| Groq API integration for issue analysis | Implemented and tested |
| AI-generated decision analysis | Implemented; structured JSON validation is in progress |
| Decision Card display | Partially integrated |
| AI-generated technical question | Partially integrated |
| Answer input | Implemented |
| Answer scoring and feedback | **Rule-based mock**; AI evaluator pending |
| Jira comment saving | Implemented in the app; end-to-end verification ongoing |
| Error handling and end-to-end tests | In progress |

**Important:** The current runtime uses **Groq** with the `openai/gpt-oss-20b` model. Some Jira WBS tickets still refer to **Gemini**, reflecting an earlier implementation plan. Follow the actual code and coordinate any provider changes with the integration owner.

## Tech Stack

- **Platform:** Atlassian Forge
- **Host product:** Jira Cloud
- **Frontend:** React with Forge UI Kit (`@forge/react`)
- **Backend:** Forge Resolver (`@forge/resolver`) and Forge API (`@forge/api`)
- **LLM provider:** Groq (current implementation)
- **Version control:** Git and GitHub

## Repository Structure

```text
decision-context-coach/
├── manifest.yml
├── package.json
└── src/
    ├── frontend/
    │   └── main-ui-kit/
    │       └── jira-issue-panel.jsx
    └── resolvers/
        └── jira-issue-panel.js
```

The paths above describe the main application files; additional configuration and support files may exist.

## Getting Started

### Prerequisites

- Git
- A supported Node.js LTS version and npm
- An Atlassian account
- Access to the private GitHub repository
- Access to the team's Jira Cloud test site for integration testing
- Atlassian Forge CLI for deployment or local Forge development

### 1. Clone the Repository

```bash
git clone https://github.com/02som/decision-context-coach.git
cd decision-context-coach
npm install
```

### 2. Install and Authenticate Forge CLI

```bash
npm install -g @forge/cli
forge login
```

Follow the authentication prompts using your own Atlassian credentials.

### 3. Validate the Project

```bash
forge lint
```

**Do not deploy the shared app immediately.** Ask the integration owner for an approved development environment and Jira site before deploying or installing the app. Multiple developers deploying to the same Forge environment can overwrite one another's changes.

### 4. Run the App in Jira (Authorized Developers)

Forge apps run **inside Jira**, not as standalone websites started with `npm start`.

Once you have permission to use an isolated Forge environment and a test Jira site, coordinate the following commands with the integration owner:

```bash
forge deploy -e <approved-environment>
forge install -e <approved-environment>
```

Select the appropriate Jira site during installation. Installation may already be completed for the selected environment; upgrades or permission changes may require additional approval.

To iterate on backend or UI changes during development, use Forge's supported local development workflow (for example, `forge tunnel -e <approved-environment>`) after confirming your environment setup.

**Never deploy to the shared `development`, `staging`, or `production` environment without coordination.**

## Configuration and Secrets

The app calls the Groq API from the Forge backend. The API key must be configured as a Forge environment variable; **never commit API keys or credentials**.

For an authorized environment, the integration owner can configure the secret using:

```bash
forge variables set --encrypt GROQ_API_KEY <your-groq-api-key> -e <approved-environment>
```

Redeploy the relevant environment if required for the variable change to take effect.

The Forge manifest must also permit the external Groq API endpoint and include the Jira scopes needed by the app. Coordinate manifest or permission changes before merging.

> Do not copy production secrets into personal environments or share secret values in chat, issues, commits, screenshots, or pull requests.

## Team Contributions and Responsibilities

### Original Concept

**Kang Seongyun (강성윤)** — Original project idea and concept proposal for DevDecision / Decision Context Coach.

Concept contribution is credited separately from the implementation assignments in the revised Jira WBS. This distinction recognizes the original idea without implying that the concept contributor owns an engineering workstream in the current WBS.

### Implementation Responsibilities

The current engineering assignments follow the **revised Jira WBS dated November 22, 2026**.

## Team Responsibilities

The current development responsibilities follow the **revised Jira WBS dated November 22, 2026**. Original concept and design contributions are also acknowledged below.

| Owner | Responsibility | WBS area |
|---|---|---|
| **Somin Lee (이소민)** | LLM integration, Jira issue analysis, structured Decision Cards, question generation, application integration, deployment, demos, and submission | MT0, MT1, MT4, MT5 |
| **Kim Songheon (김송헌)** | Answer-evaluation rubric, AI evaluation prompts, feedback JSON, evidence safeguards, and evaluator tests | MT2 |
| **Kyeongseo Park (박경서)** | Jira field mapping, data preprocessing, test issues, evidence validation, and Bitbucket integration feasibility | MT3 |
| **Kang Seongyun (강성윤)** | Original project idea, concept proposal, and initial service ideation | Concept |
| **Hyunju Oh (오현주)** | user flow planning, 27-screen development handoff, and DevDecision user flow diagrams | Design |

For detailed task ownership and acceptance criteria, refer to the current Jira WBS (`DFAS` project). Do not use earlier WBS documents as the source of truth.

### User Flow

**Hyunju Oh (오현주)** — user-flow documentation, including the two development handoff artifacts below:

- **Development Handoff — 27 Screens — User Flow** (`개발 전달용 · 27 Screens · User Flow.svg`)
- **DevDecision — User Flow** (`유저 플로우 · DevDecision.svg`)

These design artifacts were created by **Hyunju Oh**. Her design contribution is credited separately from the engineering assignments in the revised Jira WBS. If these files are added to the repository, update this section with their relative paths.

## Collaboration Workflow

**Use feature branches and pull requests. Do not push directly to `main`.**

### Start a Feature Branch

```bash
git switch main
git pull origin main
git switch -c feature/short-description
```

### Commit and Push

```bash
git add .
git commit -m "feat: describe your change"
git push -u origin feature/short-description
```

Then open a pull request targeting `main` and include:

- Related Jira issue key (for example, `DFAS-128`)
- Summary of changes
- Testing performed and results
- Any changes to the JSON contract, Forge permissions, environment variables, or external API usage
- Screenshots for visible UI changes, when relevant

### Before Merging

1. Pull the latest `main` and resolve conflicts in your branch.
2. Run `forge lint` and any relevant tests.
3. Confirm that no secrets or sensitive Jira data are committed.
4. Coordinate changes to shared interfaces with the integration owner.
5. Obtain review before merging.

## Integration Contracts

The project uses three major data boundaries:

```text
Jira issue context
       |
       v
LLM analysis -> Decision Card -> Technical question
                                       |
                                       v
                                  User answer
                                       |
                                       v
                              Answer evaluation
                                       |
                                       v
                                 Jira comment
```

The shared JSON contract for the Decision Card, generated questions, and evaluation output is tracked in **WBS 0.4 (`DFAS-124`)**. Until that contract is finalized, **do not assume that example field names or response shapes are stable**.

When developing an independently owned module, document its input, output, errors, and a sample payload before requesting integration.

## Security and Reliability Principles

- Treat Jira issue content as **untrusted input**, not instructions for the LLM.
- Ground AI outputs in the supplied Jira context.
- Mark missing evidence or unverifiable claims as **unverified** rather than inventing facts.
- Do not represent rule-based mock scores as factual or AI-verified judgments.
- Handle API failures, empty responses, malformed JSON, and timeouts explicitly.
- Keep secrets in Forge environment variables, not source code.
- Test against non-sensitive Jira issues whenever possible.

## Project Tracking

- **GitHub:** https://github.com/02som/decision-context-coach
- **Jira project:** `DFAS` — Codegeist 2026
- **Planning baseline:** Revised WBS, November 22, 2026

## License

No open-source license has been specified yet. Please contact the repository owner before redistributing or reusing the code outside this project.
