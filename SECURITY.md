# Security policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in
`convex-evalbench`, **please do not open a public GitHub issue**.

Instead, email the maintainers at <thorben@fohlmeister.com> with:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The version (commit SHA or npm version) you observed it on
- Any deployment context that matters (Convex version, whether content
  recording is enabled, etc.)

You will receive an acknowledgement within 72 hours. We aim to publish
a fix or mitigation within 30 days for high-severity issues; lower-
severity issues may take longer.

## Supported versions

This project is pre-1.0. Only the latest published version receives
security fixes. Once a 1.x release ships, we will support the current
major plus one prior major for security fixes.

## Threat model and known limits

The component is designed under the following assumptions, which are
worth understanding when evaluating its security posture:

- **The host application is trusted.** The component runs inside the
  same Convex deployment as the host, and the host can call any of the
  component's public functions. The component does not defend against a
  malicious or buggy host.
- **Spans can carry secrets.** Raw `input`/`output` content is opt-in
  (off by default, `recordContent: false` in the agent adapter), but
  when you enable it, prompts and completions are stored verbatim,
  including any PII or credentials they contain. Span metadata (model,
  tokens, latency, operation name) is always stored.
- **Read access is not enforced by the component.** `spansByTrace`,
  `recentTraces`, and `spanContent` are exposed only through whatever
  queries you wrap them in; gate those wrappers with your own
  authorization checks. `spanContent` returns signed File Storage URLs
  for offloaded content.
- **Recording is best-effort by design.** A failed `recordSpan` is
  logged and swallowed so it never breaks your LLM call. That also
  means missing spans are silent; do not use traces as an audit log of
  record.
- **The trace table is unbounded.** No automatic retention. Prune old
  spans from a host cron if growth matters to you; built-in retention
  helpers are on the roadmap.
