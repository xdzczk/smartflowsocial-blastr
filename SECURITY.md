# Security

## Reporting vulnerabilities

If you believe you have found a security vulnerability in Blastr, please report it responsibly.

- **Preferred:** Open a [GitHub Security Advisory](https://github.com/cloudflare/workers-sdk/security/advisories/new) in this repository (or the canonical Blastr repo if different). This allows private disclosure and coordinated release.
- **Alternative:** Email the maintainers (see repository description or owner profile) with a clear description of the issue, steps to reproduce, and impact. Do not open a public issue for unfixed security vulnerabilities.

## What to expect

- We will acknowledge your report as soon as practicable.
- We aim to provide an initial assessment within a reasonable timeframe (e.g. within a few business days).
- We will work with you to understand and fix the issue and will credit you in any advisory or release notes unless you prefer to remain anonymous.
- We may follow a coordinated disclosure process (fix first, then public advisory) for critical issues.

## Scope

- Blastr worker code, configuration, and dependencies are in scope.
- Out-of-scope: issues in Cloudflare’s infrastructure, Nostr protocol design, or third-party relays we fan out to (except where our integration is at fault).

## Dependency hygiene

- We run `pnpm audit` in CI and fail on high/critical vulnerabilities where possible.
- We encourage dependency updates and use of Dependabot or Renovate for automated PRs.
