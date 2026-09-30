# Security policy

## Reporting

Please report suspected vulnerabilities privately to the repository owner through GitHub's private vulnerability reporting feature. Do not open a public issue with exploit details. If private reporting is unavailable, contact the maintainer through the email listed on the GitHub profile.

## Security boundaries

Agent Decision Kit runs locally with the permissions of the coding agent that starts it. MCP servers are executable code. Review configuration and source before enabling it.

- Browser page text and labels are untrusted and may contain prompt injection. They are bounded, and the selector can only return an advertised visible action ref.
- Sensitive action detection is heuristic. Do not rely on its labels alone for money movement, deletion, publication, or other consequential operations. Review the proposed action and call `browser_confirm` yourself.
- The diff scanner is a fast pre-review, not a security audit.
- The completion checker uses text overlap and cannot prove tests passed or behavior is correct.
- Do not put secrets in browser pages used with remote providers. Remote browser context is blocked unless `AGENT_ALLOW_REMOTE_BROWSER_CONTEXT=true`.
- Password, hidden, and file inputs are excluded from browser snapshots and fill tools. Contenteditable draft text is masked from DOM excerpts. Private form values and action destinations are hashed locally only to invalidate stale approvals; raw values are not returned to the agent.
- A pending approval is cancelled if its page, private form state, or action destination changes. A semantic browser decision is discarded if the page changes while the provider is working. These checks reduce stale-action risk but cannot guarantee how a page's JavaScript will handle a click.
- CDP access grants control of a local Chrome debugging session. Only connect to a loopback endpoint you started and selected.

Supported releases receive security fixes on the current alpha line. There is no hosted service or telemetry endpoint.
