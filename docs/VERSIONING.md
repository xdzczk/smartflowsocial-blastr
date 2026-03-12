# API versioning

## Current version

The Blastr HTTP and WebSocket API is considered **v1** (implicit). There is no path prefix or version header required today.

## Future breaking changes

When we introduce **breaking** changes (e.g. removing or changing request/response shapes, changing error codes, or changing authentication behavior), we will:

1. **Introduce a new version** via one of:
   - A new path prefix (e.g. `/v2/event`), or
   - An `Accept-Version` request header (e.g. `Accept-Version: 2`).
2. **Keep v1 supported** for a documented deprecation period.
3. **Document migration** in release notes and the changelog.

Non-breaking changes (new optional fields, new endpoints, new query parameters) may be added to the current API without a new version.

## Changelog and release notes

- [CHANGELOG.md](../CHANGELOG.md) at the repo root lists user-facing and breaking changes per release.
- Release notes will call out breaking changes and migration steps.

## Optional client hints

- A response header **`X-API-Version: 1`** may be added so clients can detect the serving version.
- The NIP-11 response (relay info) may include a **`version`** field in the future for the same purpose.
