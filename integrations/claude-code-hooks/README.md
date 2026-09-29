# Optional Claude Code prompt-routing hook

This opt-in hook runs the project's deterministic `routeModel` helper on each submitted prompt and adds its suggested route to Claude Code's context. It runs locally, uses no model or network, and never switches the active Claude model. It is an unbenchmarked hint; ignore or override it when it does not fit the task.

## Install from a source checkout

Build Agent Decision Kit first:

```sh
npm install
npm run build
```

Merge this hook into `.claude/settings.json` (project scope) or `~/.claude/settings.json` (user scope). Replace the command path with the absolute path to this checkout. Keep any existing `hooks` entries in the file:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/absolute/path/to/agent-decision-kit/integrations/claude-code-hooks/route-prompt-hook.mjs\""
          }
        ]
      }
    ]
  }
}
```

On Windows, use the matching absolute path and shell quoting accepted by your Claude Code installation. Restart or reload the session, then run `/hooks` to confirm the `UserPromptSubmit` hook is active. Remove this single entry to turn it off.

## Verify without Claude Code

From the repository root, run `npm run hook:verify`. This feeds a sample hook event to the script and validates its structured response. The project does not claim an end-to-end test against every Claude Code release.

The hook follows Claude Code's [`UserPromptSubmit` hook input/output format](https://code.claude.com/docs/en/hooks-guide#structured-json-output). Prompts remain on the machine; the script only applies visible keyword rules and returns a route suggestion.
