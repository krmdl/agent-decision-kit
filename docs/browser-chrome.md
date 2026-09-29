# Connect to a selected local Chrome tab

Agent Decision Kit can attach to a tab in a separate Chrome profile through the local Chrome DevTools Protocol (CDP). The connection is deliberately two-step: first list the available tabs, then pass the index of the tab you selected. It never chooses the first tab automatically.

## Start a dedicated Chrome profile

Use a non-default profile directory for remote debugging. Chrome 136 and newer ignore the remote-debugging switches for the default Chrome data directory; Chrome's documentation recommends a custom directory to keep debugging separate from real profiles ([Chrome remote-debugging security change](https://developer.chrome.com/blog/remote-debugging-port)).

Windows PowerShell (adjust the Chrome executable path if needed):

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:LOCALAPPDATA\AgentDecisionKit\ChromeProfile" `
  about:blank
```

macOS:

```sh
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/AgentDecisionKit/ChromeProfile" \
  about:blank
```

Linux:

```sh
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.local/share/agent-decision-kit/chrome-profile" \
  about:blank
```

Open the page you want to work with in this dedicated window. Do not point remote debugging at your normal Chrome profile. CDP grants browser-control access to the local process, so close this debugging window when you are done.

## List, choose, then connect

Call `browser_connect` without `pageIndex`:

```json
{ "endpoint": "http://127.0.0.1:9222" }
```

The result lists open tabs with an `index`, title, and URL, but does not attach. URL credentials, query strings, and fragments are removed from the output. Review the list and call the tool again with the index you selected:

```json
{ "endpoint": "http://127.0.0.1:9222", "pageIndex": 1 }
```

The tool reads the local `/json/version` endpoint to discover Chrome's WebSocket address. It accepts only loopback HTTP discovery URLs or loopback `ws://` endpoints. Set `AGENT_DECISION_CDP_URL` in the MCP server's environment to use a different local port, or pass `endpoint` directly.

## What page data is used

The browser tools do not return cookies, storage, password fields, file inputs, or form values. URLs returned by the tools and supplied to the decision model have credentials, query strings, and fragments removed; local file paths are redacted. For a decision, the tools can send the remaining page URL, title, headings, a bounded text excerpt, and up to 80 visible action labels to the configured decision provider. The local provider keeps that context on the machine. Remote providers are blocked for browser context unless `AGENT_ALLOW_REMOTE_BROWSER_CONTEXT=true` is explicitly set in the server environment.

For most tasks, the default `browser_launch` tool is simpler: it opens a separate persistent Playwright profile without requiring Chrome's debugging port.
