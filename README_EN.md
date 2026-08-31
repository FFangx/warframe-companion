# Warframe Companion

[简体中文](README.md) | [English](README_EN.md)

[![CI](https://github.com/FFangx/warframe-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/FFangx/warframe-companion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

> **Status: early development.** The source and reproducible verification workflow are public, but no Windows installer has yet passed installation, upgrade, uninstall, and real-machine acceptance testing. Passing source-level tests does not mean that an installable product has been released.

Warframe Companion is a Windows, local-first, read-only, evidence-driven personal Agent host for the international version of Warframe. Its goal is to deliver deterministic queries, personal snapshots, subscription diagnostics, and Agent capabilities as an installable desktop application. Controlled Channel Adapters preserve QQ/OpenClaw support and may extend to Lark, WeChat, or other remote channels when there is a demonstrated need.

The repository currently contains end-to-end desktop slices for market data, public drop data, and the Agent: the `market.query` contract; versioned `drops.search` data with separate cache-freshness and source-age checks plus alternative-source comparison; a license-attributed Chinese/English alias layer; real read-only adapters; an Electron/React desktop application; a system health page; a native market result card; streaming Agent conversations; and 41 synthetic or redacted evaluation cases with deterministic, desktop-Harness, and OpenAI-compatible mock baselines.

The desktop Agent is built on the Companion-owned Warframe Harness. It controls `ModelProfile` and `ModelAdapter` selection, capability and health gates, trusted policy, tool execution, cancellation and timeout behavior, and auditable traces. In addition to two zero-cost local-rule profiles, the desktop app can store local OpenAI-compatible profiles. Profiles retain only the base URL, model name, capability declaration, and an environment-variable reference to the credential—never the key itself. The adapter supports `/models` health checks, structured Chat Completions tools, SSE, cancellation, and stable error classification. Adapters that support tool-result round trips receive redacted result summaries and must finish with text or the internal `agent.conclude` contract. Facts, evidence, identity, refusals, and latency remain under deterministic Harness control, with deterministic fallback after a later model failure. No remote model is contacted unless the user explicitly configures one and sends a request. See [docs/AGENT_HARNESS.md](docs/AGENT_HARNESS.md).

The DeepSeek Harness experiment is pinned to a reviewed upstream commit, built without modification, and isolated behind plugin, policy, event-adapter, and keyless preflight boundaries. Its historical v1 score of 0/30 and v2 rescore of 5/30 on the same traces are retained only as integration smoke tests and scoring-protocol history. Hidden defaults, runtime configuration, and name-normalization differences make those results unsuitable for comparing models, frameworks, or harnesses. The [v1/v2 comparison](packages/agent-eval/reports/v2/v1-v2-comparison.md) documents that limited role.

## Repository layout

```text
docs/                           Product, architecture, portfolio, and session conventions
packages/market-query-contract  market.query types, errors, redacted mocks, and contract tests
packages/market-query-service   Warframe.Market v2 adapter, evidence mapping, and failure tests
packages/warframe-data-service  WFCD public drop snapshots, atomic local cache, and in-memory index
packages/agent-runtime          Streaming Agent Harness shared by desktop production and evaluation
packages/agent-eval             41 synthetic evaluations, structured trace runner, and baseline reports
apps/desktop                    Electron/React app, health page, market card, and Agent conversation UI
experiments/deepseek-harness    Isolated DSH tool/policy/trace experiment and comparison reports
```

New desktop and evaluation packages are added only through accepted development slices; the project does not create speculative empty scaffolding.

## Development and verification

Node.js 22 or later is required:

```powershell
npm ci
npm run check:repo
npm run build
npm test
npm run eval --workspace @warframe-companion/agent-eval
npm audit --omit=dev --audit-level=high
npm run smoke:live --workspace @warframe-companion/warframe-data-service
npm run start -w @warframe-companion/desktop

# Isolated DSH experiment with its own lockfile
npm ci --prefix experiments/deepseek-harness
npm test --prefix experiments/deepseek-harness
npm run preflight --prefix experiments/deepseek-harness
```

## Safety boundaries

- Warframe, AlecaFrame, market, and account integrations remain read-only. The project never automates the game, trading, chat, or account assets.
- Never commit API keys, market tokens, QQ identifiers, AlecaFrame decryption keys, raw personal snapshots, real conversations, or local logs.
- Claims about changing state must carry deterministic evidence for the matched object, scope, time, freshness, and source.
- Mocks, evaluation fixtures, screenshots, and demo data must be synthetic or redacted.

Report security issues through the private vulnerability-reporting path described in [SECURITY.md](SECURITY.md). Do not place credentials, personal data, or vulnerability details in a public issue.

Use the [development plan](docs/DEVELOPMENT_PLAN.md) as the execution roadmap. Product and technical boundaries are documented in [docs/PRODUCT.md](docs/PRODUCT.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). See [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) for acceptance levels, [docs/DEPENDENCY_RISK.md](docs/DEPENDENCY_RISK.md) for known dependency risk, and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements.

## Related-repository boundaries

- `openclaw-warframe-assistant`: the current production QQ/OpenClaw channel adapter and runtime skill.
- `WFInfo-CN-DPI-Fix`: the separate WFInfo application and its in-game reward-assistance features.
- `deepseek-harness`: a sibling pinned upstream research copy used only for isolated plugin experiments; it is not a dependency of the stable desktop path.
- This repository: shared contracts, application services, desktop UI, and the Agent evaluation system.

## License and support

The code is available under the [MIT License](LICENSE). Ownership of Warframe-related data, names, trademarks, and third-party data boundaries is described in [NOTICE.md](NOTICE.md). This is a personal, hobby-maintained project with no SLA; see [SUPPORT.md](SUPPORT.md).
