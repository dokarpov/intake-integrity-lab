# Read-only MCP adapter for ChatGPT and Claude (Release 1 candidate)

**Status: testing implementation, not a customer-facing connected integration.**
**Entry point:** `POST /mcp` served by `service/server.mjs`.
**Protocol:** Model Context Protocol Streamable HTTP, stateless JSON-RPC 2.0 over HTTP, negotiation for `2025-11-25`. No SSE subscription, prompts, agent execution or write tools.

One remote MCP server is intended to serve both ChatGPT and Claude. **There is no GPT-to-Claude model messaging or shared local-computer capture in this scope.** Those are separate products/permission boundaries.

## Implemented tools
1. `list_source_snapshots`: read existing versioned 1C / Bitrix24 snapshot metadata (no arbitrary filesystem paths or customer-import keys).
2. `get_latest_discrepancies`: read latest persisted comparison with policy version, observations and counts; return at most 30 observations. By default field values and identifying record keys are withheld. `includeValues:true` additionally requires `audit.read`.
3. `list_comparison_assessments`: read existing human assessments of a UUID comparison; requires both `review.read` and `audit.read`.

**No tools** accept tenant ID, actor ID, SQL, provider credentials, source URLs, network destinations or proposed business decisions. No tools submit snapshots, modify CRM, resolve cases, merge identities, approve discrepancies or authorize customer data processing. Source records are treated as untrusted **observations**, never as instructions for an assistant.

All tool invocations use verified per-request SaaS OIDC membership; the tenant scope is set server-side in the PostgreSQL transaction. Access revocation is checked for every MCP POST. Raw errors are redacted. Only JSON responses are supported; nonempty browser Origin headers are rejected by default. Body cap 16 KiB; output evidence is bounded. Shared staging-token access is not supported.

## Boot and database constraints
MCP is **disabled by default**. Set `MCP_READONLY_ENABLED=true` only after the separate customer data, IdP and release gates have been approved.

Startup requires:
- `NODE_ENV=production`, verified `WORKSPACE_DIRECTORY_AUTH_ENABLED=true`, enforced `WORKSPACE_MEMBERSHIP_ENFORCED=true`, configured SaaS OIDC verifier, and `INTEGRITY_PG_V2_ENABLED=true`.
- A separate `MCP_DATABASE_URL`, **not** the main `DATABASE_URL`. It must connect using a dedicated login role with `SELECT` and schema usage only on four source-evidence tables. It must not own tables, bypass RLS, have CREATE ROLE or any INSERT/UPDATE/DELETE permission.
- Migrations 005 (source comparison), 007 (tenant RLS) and 006/009/010 (issuer-bound workspaces) applied and independently tested. Production role preflight checks RLS on all four source evidence tables. Existing production runtime preflight also checks workspace directory permissions.

The connector must use TLS end to end, managed secrets (never publish connection strings), credential revocation, explicit per-tenant lawful data-sharing scope and audit/incident logging. **MCP code does not itself prove or implement these infrastructure/legal controls.**

## Connection with ChatGPT or Claude — additional required work
A ChatGPT/Claude remote-connector UX is **not unlocked merely by running this server**. The MCP adapter accepts the SaaS's existing signed **OIDC access bearer**; it does not issue tokens or implement OAuth 2.1 client discovery/registration, delegated consent, authorization-code + PKCE, access-token audience binding, refresh/revocation, resource metadata or OpenAI/Anthropic installation verification. Never paste a user's main SaaS token into a broadly shared connector configuration.

Before externally enabling either client:
1. Choose a customer IdP/auth-server able to issue *delegated, revocable, resource-specific* credentials for the MCP endpoint. Implement OAuth protected resource metadata/authorization-server discovery with a controlled client registration policy and connect/disconnect user consent.
2. Bind tokens to the exact MCP resource audience, enforce scopes (e.g. `evidence:read`, `evidence:values:read`) **and** per-request DB workspace roles. Do not rely on untrusted JWT tenant/roles or on global API keys.
3. Add correct MCP 401 `WWW-Authenticate` challenge, OAuth callback/redirect allowlist, client-origin and DNS-rebinding defense, session/revocation tests, audit/access logging, and abuse/rate limits. Re-test ChatGPT and Claude independently with the provider's current client capabilities.
4. Provision production tenant-isolated source connectors and data-retention decisions; the existing CSV synthetic comparison is **not** production evidence or a connected 1C/Bitrix24 integration.
5. Roll out behind a separate feature flag and customer approval; run a real-account read-only smoke and security/privacy review. No write tools in Release 1.

## Local protocol smoke (authenticated bearer issued by test IdP)
```bash
curl -sS https://your-reviewed-host.example/mcp \
  -H 'Authorization: Bearer <verified-single-tenant-access-token>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"mcp-test","version":"1"}}}'
```

This is a protocol example, not a deployable customer credential. The remote MCP endpoint cannot be tested through shared-token staging because that environment deliberately blocks customer-data access.

## Evidence and release gates
- `tests/mcp-readonly.test.js`: actual HTTP JSON-RPC handshake, list/call, denied writes, revocation, tenant spoofing, raw-value permission boundary and error redaction.
- `tests/mcp-production-boundary.test.js`: startup fails for privileged roles, missing tables/RLS and DML grants.
- `tests/integration/mcp-readonly.live.test.js`: real, disposable PostgreSQL comparisons and cross-tenant negative reads.
- Existing `tests/integration/source-rls.live.test.js` remains the restricted-role SQL isolation test.

**Do not claim:** OAuth connector installed, ChatGPT/Claude successfully connected, external connectors authorized, full SaaS workflow, or production launch. Existing production gates #13–#20 remain open.
