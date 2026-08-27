# pi-claude-style-tui

A Pi package that provides a Claude Code-inspired header, editor, footer, theme, and turn telemetry.

## Installation

Install from a GitHub repository:

```bash
pi install git:github.com/<owner>/<repository>
```

Or install from a local checkout:

```bash
pi install /path/to/checkout
```

## Features

- Compact single-column welcome card
- Claude Code-inspired dark palette and prompt styling
- Straight input separators and `❯` prompt markers
- Safe `●` markers for prose-first Assistant responses without breaking block Markdown
- Compact `● Tool(args)` / `└ result` rows for Pi-owned built-in tools, with expandable output
- Configurable footer with ordered Claude/Pi fields for model, context, workspace, session, usage, cache, cost, and duration
- Pi-compatible context alerts (`>70%` warning, `>90%` error), cache totals, and session cost
- Claude-style spinner verbs, mirrored `✻` working-glyph animation, delayed elapsed time, and estimated output-token count
- Persistent `<verb> for <duration>` turn summaries
- Slash-command highlighting

## Development

```bash
npm install
npm run typecheck
npm test
```

Run directly from the checkout:

```bash
pi -e .
```

## Commands

- `/statusline` — toggle and reorder footer fields (`Space`, `←/→`, `Enter`); saves to `~/.pi/agent/claude-code-tui.json`
  - Fields: model, context, directory, cache, cost, session name/ID, transcript path, version, context remaining/window, input/output tokens, duration, and >200k warning
- `/use-claude-style-tui` — enable the custom TUI
- `/use-default-tui` — restore Pi's built-in TUI

## License

MIT
