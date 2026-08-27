# Project UI Constraints

## Scope

- Implement Claude-inspired behavior through Pi extensions and themes only. Do not patch or import Pi's private interactive-mode components.
- Preserve Pi's runtime behavior and session format.

## Message-area extension limits

- Pi's public extension API cannot replace the built-in `UserMessageComponent` or `AssistantMessageComponent` shells. In the current Pi implementation, user messages always use `Box(outputPad, 1, ...)`; the fixed vertical padding cannot be removed by a theme or extension. `outputPad` only controls horizontal padding and has no extension setter.
- `registerMarkdownTransformer()` can change Markdown content but cannot create Claude's independent left gutter. Prefix Assistant prose only when doing so cannot alter block-level Markdown parsing; headings, lists, quotes, fences, and tables must remain unprefixed until Pi exposes a normal-message renderer.
- `setHiddenThinkingLabel()` can rename Pi's hidden-thinking row, but extensions cannot attach Claude's per-thinking-block duration or implement Claude's transcript-specific `ctrl+o` behavior. Keep Pi's native thinking visibility and expansion behavior.
- Pi's public extension API cannot replace or configure the built-in `CompactionStatusIndicator` or `CompactionSummaryMessageComponent`. The transient `Compacting context...` row, its spinner, and the completed compaction shell therefore remain Pi-native until a public compaction renderer is exposed; do not import the private interactive-mode components or add a duplicate status row.
- Compact built-in tool rows require same-name tool registration with `renderShell: "self"`. Delegate execution to Pi's exported `create*ToolDefinition()` factories and skip any tool already owned by another extension so SSH, sandbox, or other custom execution backends are not replaced.
- Pi has no API to unregister a tool override during a session. `/reload` reloads this package and registers compact tool renderers again; restoring built-in tool shells requires starting Pi without this extension.
