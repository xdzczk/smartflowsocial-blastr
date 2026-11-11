# Contributing to Blastr

Thank you for your interest in contributing. This document explains how to run checks, write tests, and submit changes.

## Before you start

- **Node.js** ≥20 and **pnpm** 10.x are required.
- Install dependencies: `pnpm install`.
- Run the full validation and test suite locally before opening a pull request.

## Development workflow

### 1. Validate code quality

Run format check, lint, and typecheck:

```bash
pnpm validate
```

This runs:

- `pnpm format:check` — Prettier
- `pnpm lint` — ESLint (with cache)
- `pnpm typecheck` — TypeScript `tsc --noEmit`

Fix issues with:

- `pnpm format` — Auto-format with Prettier
- `pnpm lint:fix` — ESLint auto-fix

### 2. Run tests

```bash
# All tests
pnpm test

# Unit tests only
pnpm test:unit

# Integration tests only
pnpm test:integration

# With coverage
pnpm test:coverage
```

Tests live under `tests/` and mirror the `src/` layout (e.g. `tests/core/`, `tests/transport/`, `tests/services/`). Keep coverage above the configured thresholds.

### 3. Pre-commit hooks

Husky runs lint-staged on commit:

- `*.ts` — ESLint --fix, Prettier --write
- `*.{js,json,md,yml,yaml}` — Prettier --write

Ensure `pnpm prepare` has been run (it runs automatically after `pnpm install`).

## Code standards

- **TypeScript** — Strict mode; avoid `any`. Use the existing `Env`, `PublishJobMessage`, and shared types in `src/types.ts`.
- **Errors** — Use `BlastrError` and `ErrorCodes` from `src/errors.ts` for consistent error handling.
- **Structure** — Transport layer calls core and services; avoid route-to-route or circular imports.
- **Logging** — Use the project logger with correlation ID where available.

## Pull requests

1. Branch from `main` (or `master`) and keep changes focused.
2. Run `pnpm validate` and `pnpm test` (and ideally `pnpm test:coverage`) before pushing.
3. Ensure CI passes (validate, unit tests, integration tests, security tests, coverage with thresholds).
4. Keep the PR description clear: what changed and why.

## Documentation

- Update the README or `docs/` if you change behavior, config, or APIs.
- The design and architecture are described in `docs/SFS_BROADCAST_RELAY_DESIGN.md` and `docs/ARCHITECTURE.md`; align with those when touching core flow or data model.
- **Changelog:** Add an entry under the **Unreleased** section in [CHANGELOG.md](CHANGELOG.md) for any user-facing or breaking change (API, config, behavior). Releases follow semver; tags are `v1.0.0`, etc.

## Questions

For project-specific questions or access, reach out to the maintainers or open an issue.

## Code of conduct

This project follows the [SmartFlowSocial Code of Conduct](CODE_OF_CONDUCT.md). Report unacceptable behavior on Nostr at `npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`.
