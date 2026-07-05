# Contributing

Thanks for your interest. This guide covers the dev loop, the test
setup, and the release flow.

If you're new to the project, the [README](./README.md) and
[docs/tracing.md](./docs/tracing.md) are better entry points than this
file.

## Local setup

This repo bundles its own pinned `convex-local-backend` binary so you
can deploy and exercise the component without a cloud Convex project.
The binary is downloaded into `.tools/` on first use.

```sh
pnpm install
pnpm local:start            # downloads the binary, writes .env.local,
                            # runs the backend on :3312 / :3313
```

## Day-to-day

In a second shell, with the backend from `pnpm local:start` running:

```sh
pnpm convex:codegen         # regenerate _generated/ for component + example
pnpm typecheck
pnpm test
pnpm lint
```

`pnpm check` runs all of the above (codegen + build + typecheck + test +
lint), but the codegen step requires a running local backend.

Keep `_generated/` directories committed: CI
(`.github/workflows/test.yml`) builds against them and needs no live
backend.

## Tests

Run with `pnpm test`. Tests use [`convex-test`](https://www.npmjs.com/package/convex-test);
the `convex-evalbench/test` export registers the component schema so
host-side tests can exercise the real component functions. The two
`example/*-proof.mjs` scripts drive a real local backend end to end.

When you change behavior, update or add the matching test in the same
change.

## Documentation

User-facing changes need a docs update. Tracing behavior is documented
in [docs/tracing.md](./docs/tracing.md); new top-level concepts get a
new `docs/<concept>.md` plus a link from `README.md`.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org): the
prefix drives the next version. `fix:` triggers a patch, `feat:` a
minor, and `feat!:` or a `BREAKING CHANGE:` footer a major bump. Other
types (`chore:`, `docs:`, `ci:`, `refactor:`) do not bump the version
and are hidden from the changelog by default.

## Releasing

Releases are automated with
[release-please](https://github.com/googleapis/release-please). On every
push to `main` it reads the Conventional Commits since the last release
and maintains a "release PR" that bumps the version and updates
`CHANGELOG.md`.

To cut a release, merge that PR. release-please then creates the
`v<x.y.z>` tag and the GitHub release, and the publish job in
`.github/workflows/release.yml` runs. That job is gated by the `release`
environment, so a required reviewer still approves the publish.

Publishing uses npm Trusted Publishing (OIDC), so no `NPM_TOKEN` secret
is needed. The Trusted Publisher is registered for workflow file
`release.yml`.
