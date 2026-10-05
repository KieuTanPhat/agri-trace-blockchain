---
name: graphify
description: Query or refresh the local Graphify map of agri-trace-blockchain code, current schema and selected architecture documents. Use for repository architecture, dependencies and business flow questions.
---

# Graphify for this repository

This is a project adaptation of Graphify 0.9.75. Use the pinned wrapper below.
The upstream installer was reviewed in a disposable directory; its global
installation, hooks and auto-upgrade commands do not apply to this project.

## Ask about the project

From the repository root:

```powershell
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py status
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py query 'RecordHarvestService TraceService outbox' --budget 1800
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py explain '<exact node ID>'
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py path '<source node ID>' '<target node ID>'
```

Use labels/IDs actually present in `graphify-out/graph.json`. For Vietnamese
questions, choose relevant English symbol names from the graph. Read
[query.md](references/query.md) for vocabulary expansion and traversal concepts;
execute its examples through the project wrapper, which checks freshness.
If output is truncated, narrow the query or raise its budget before concluding
that a symbol or relationship is absent.

Treat graph edges as navigation evidence. Verify relevant current source lines
before explaining behavior or editing code. `EXTRACTED` means extracted from
source, and does not guarantee a resolved call target. In particular, NestJS
provider bindings, ORM delegates, HTTP routes, persisted outbox delivery and
Fabric transaction dispatch need source inspection. A shortest path can contain
imports, containment or references; it is not automatically a call chain.
JSON retains parallel relationships; HTML/CLI traversal use a simple DiGraph.

## Refresh

If the environment is absent, use `tools/graphify/setup.ps1` with Windows x64
CPython 3.13. The equivalent Python commands are in `docs/graphify-usage.md`.
Do not install globally or silently change versions/lock/platform.

```powershell
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py update --code-only
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py sources
```

`--code-only` deliberately leaves the document layer pending. A plain `update`
reuses host-extracted document content only when its documents, cited evidence,
prompt and fragment hashes still match. It never calls a model API. Do not
present a pending document layer as fresh document analysis.

For a full refresh, read [extraction-spec.md](references/extraction-spec.md).
Use one semantic extraction subagent for the five approved Markdown files
returned by `sources`, as required by the upstream Graphify extraction workflow.
Pass that prompt and those absolute filenames verbatim, DEEP_MODE=false. The
agent reads the selected documents and writes only
`.tools/graphify/semantic.json`, with all edge endpoints present and at least one
node per document. Exact agent token counts are unavailable: leave the required
zero placeholders and report usage as unknown. No additional API key is needed.
If cited source evidence changed, review the relevant source and update the
context document before preparing `sources` and extracting again.

```powershell
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py record-semantic
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py update
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py status
```

`record-semantic` rejects extraction if the prepared inputs changed. The wrapper
rebuilds from the complete approved corpus using AST cache, so deleted files
disappear. Unsupported source constructs and filtered receiver mismatches are
reported as limitations, not silently treated as verified relationships.

## Project scope

Read `docs/graphify-context.md` for business flows and migration caveats, and
`docs/graphify-usage.md` for commands, acceptance results and removal.
The Prisma-derived SQL is analysis input only: never apply it to a database.
Historical DOCX/business specifications are excluded from the current graph.
`.graphifyignore`, `.gitignore` and the wrapper's path allowlist control the
corpus. Broaden them only when the user asks to include additional inputs.
Keep environments, caches, graphs and local evidence out of Git/Docker.
This integration uses manual updates. It does not authorize hooks, watchers,
MCP servers, runtime dependencies, global Codex settings or external publishing.

Upstream: [Graphify](https://github.com/Graphify-Labs/graphify), package
`graphifyy[sql]==0.9.75`. The bundled reference prompt and query guide retain
their upstream license in `references/LICENSE.graphify` and notices.
