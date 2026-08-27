# pi-claude-style-tui

A Pi package that provides a Claude Code-inspired header, editor, footer, theme, and turn telemetry.

## Installation

Install the package from npm:

```bash
pi install npm:pi-claude-style-tui@1.0.0
```

To try it without adding it to your Pi settings:

```bash
pi -e npm:pi-claude-style-tui@1.0.0
```

Update or remove the package:

```bash
pi update npm:pi-claude-style-tui
pi remove npm:pi-claude-style-tui
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
npm run check
npm run typecheck
npm test
```

Run directly from the checkout:

```bash
pi -e .
```

## Publishing

Validate the package contents and release checks before publishing:

```bash
npm pack --dry-run
npm publish --access public
```

`npm publish` validates formatting, lint, import order, typecheck, and tests through the `prepublishOnly` script.

## Commands

- `/exit` — exit Pi; equivalent to `/quit`
- `/statusline` — toggle and reorder footer fields (`Space`, `←/→`, `Enter`); saves to `~/.pi/agent/claude-code-tui.json`
  - Fields: model, context, directory, cache, cost, session name/ID, transcript path, version, context remaining/window, input/output tokens, duration, and >200k warning

## License

MIT
