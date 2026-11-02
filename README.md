# pi-claude-style-tui

A Pi package that provides a Claude Code-inspired header, editor, footer, theme, and turn telemetry.

## Installation

Install the package from npm:

```bash
pi install npm:pi-claude-style-tui
```

To try it without adding it to your Pi settings:

```bash
pi -e npm:pi-claude-style-tui
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
- Adaptive one/two-row footer with ordered fields; narrow layouts prioritize context, model, and cost
- Cached session usage accounting, live Git changes, and the latest three lines of running Bash output
- Optional GitHub PR/review/check status through `gh`, refreshed at most once a minute (also on branch changes)
- Live configuration reload and model/effort/context updates, including while idle
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
- `/context` — show a Claude-style context usage bar
- `/reduced-motion [on|off]` — disable shimmer and startup Logo animation and use a static working indicator; saves to the same config file

## Live configuration

Edit `~/.pi/agent/claude-code-tui.json` (or the configured Pi agent directory). Changes apply within about one second; invalid files report an error and retain the last valid configuration. Command saves use an atomic rename and preserve unknown fields. Separate Pi processes do not lock concurrent writes.

```json
{
  "statusLine": ["model", "context", "directory", "git", "cache", "cost"],
  "footerRows": 2,
  "reducedMotion": false,
  "theme": "claude-code-dark",
  "github": false
}
```

- `footerRows`: `1` or `2`; field order is preserved and lower-priority fields are hidden when space is insufficient. Extension statuses occupy a separate row.
- `theme`: a loaded theme name, or `false` to preserve Pi's selected theme. Changing unrelated settings does not reset a theme chosen through `/settings`. Package theme-file edits still require `/reload`.
- `git`: local status refreshes every five seconds. Line totals sum staged and unstaged changes; untracked/binary files count as changed files but have no line totals.
- `pr` / `ci`: add these fields and set `github: true` to enable read-only GitHub requests. Requires `gh` and an existing `gh auth login`. Only credential-free `github.com` origin URLs are accepted. CI reports the open PR's checks, not unrelated branch workflows. Disabled, absent and unavailable states are distinct; no credentials are read or persisted by this package.
- `quota`: uses the `usage` status published by an already-installed, trusted `@narumitw/pi-usage` extension. This package does not install it or query provider accounts itself; without a source it shows `quota unavailable`. Provider refresh frequency is controlled by that extension.
- `cache-expiry`: shows `cache expiry unavailable` because Pi does not expose a reliable expiry timestamp. Cache reads/writes and hit rate remain available through `cache`; they are not subscription allowance or proof of a warm cache.
- Other fields: session name/ID, transcript path, version, context remaining/window, input/output tokens, completed duration, and >200k warning. Use `/statusline` to select and reorder fields.

Timers and in-flight status reads are disposed on reload/session shutdown. No upstream UI code is downloaded or executed automatically.

## License

MIT
