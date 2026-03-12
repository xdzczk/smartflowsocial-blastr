# Release process

Releases follow [semver](https://semver.org/). Tags are `v1.0.0`, `v1.1.0`, etc.

## Prerequisites

- CI is green (validate, unit, integration, security tests, coverage with thresholds).
- CHANGELOG.md has an **Unreleased** section with entries for user-facing or breaking changes; move those into a new version section before releasing.

## Steps

1. **Bump version** in `package.json` (e.g. `1.0.0` → `1.1.0`).
2. **Update CHANGELOG.md:** Replace the **Unreleased** heading with the new version and date (e.g. `## 1.1.0 — 2025-03-15`). Add an empty **Unreleased** section again for future entries.
3. **Commit:** e.g. `Release v1.1.0`.
4. **Tag:** `git tag v1.1.0` (and push the tag: `git push origin v1.1.0`).
5. **Deploy:** Run your deployment (e.g. `pnpm deploy` or your CI/CD pipeline). Optionally use a **manual workflow** (`workflow_dispatch`) that runs CI, then deploys when triggered with a version input.

## Optional: GitHub Actions release workflow

You can add a workflow (e.g. `.github/workflows/release.yml`) that:

- Triggers on `workflow_dispatch` with a version input.
- Runs the full CI suite.
- On success: checks out the tag or branch, runs `pnpm deploy` (or a deploy step), or triggers an external deploy.

Until then, releases are manual: bump version and CHANGELOG, tag, and deploy using your existing process.
