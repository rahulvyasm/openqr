# Contributing to OpenQR

Use Node.js 24+, install with `npm ci`, and start development with `npm run dev`.

For a change, explain the problem and resulting behavior. Include a screenshot for visual changes and meaningful tests for changes to authentication, QR content, redirect behavior, or persistence. Run `npm test` and `npm run build` before opening a pull request.

Keep dependencies small, preserve a clear self-hosting path, and never add tracking or secrets to the repository. Changes to SQLite tables need a migration strategy that preserves existing codes and tracking URLs.

All contributions are licensed under the project's MIT license. Be respectful, describe disagreements concretely, and keep discussion focused on improving the project.
