<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

<!-- GRAPHIFY_START -->
## Graphify

The project skill is `.agents/skills/graphify/SKILL.md`; the usage guide is
`docs/graphify-usage.md`. Graphify 0.9.75 lives in `.tools/graphify/venv`.

When `.codegraph/` exists, follow the CodeGraph instructions above first.
Otherwise, for code-location, architecture or business-flow questions, consult
the local Graphify map before broad source searches when its environment exists:

```powershell
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py status
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py query 'relevant actual symbol names' --budget 1800
```

The wrapper blocks stale graph queries. Refresh through the project skill when
needed. If the environment is unavailable or the graph cannot answer, inspect
the current source and state that limitation. Graphify must not block normal
development or trigger a global install/upgrade.

Always verify relevant current source lines before behavior claims or edits.
`EXTRACTED` does not guarantee an accurately resolved call target. A graph path
may contain imports or references, and does not automatically prove call flow.
NestJS DI, ORM delegates, HTTP, persisted outbox and Fabric dispatch need source
verification. Source/schema/migrations take precedence over narrative documents.
`semantic_fresh=false` means the document layer is pending. Refresh the context
and semantic extraction after its documented evidence changes.

Updates are manual through the wrapper. Keep the approved corpus controlled by
`.graphifyignore` and the wrapper allowlist. No automatic hooks/watchers, model
API calls, global Codex configuration or application dependencies are enabled by
this integration. Never execute the analysis SQL snapshot as a migration.
<!-- GRAPHIFY_END -->
