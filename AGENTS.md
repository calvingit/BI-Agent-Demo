# Project instructions

- Use TypeScript for application code and keep strict type checking enabled.
- Keep authentication, quota, permissions, sessions, and message history in `apps/api`.
- Keep model orchestration and Pi tools in `apps/agent`.
- Never let model-generated arguments define user, tenant, or shop authorization.
- Put cross-service request and event schemas in `packages/contracts` and validate every process boundary.
- Keep the default demo runnable without model credentials.
- Do not add raw SQL, shell, filesystem, or arbitrary HTTP tools to the user-facing agent.
- Treat BI calculations as deterministic backend responsibilities; the model explains validated results.
- Update relevant documents when changing an API, event, trust boundary, or technology decision.
- Before reporting completion, run type checking, tests, build, and the local smoke test.
