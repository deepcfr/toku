# `@toku/eslint-config`

Shared ESLint configurations:

- `@toku/eslint-config/base` — all workspaces (Node/Bun globals, turbo plugin, only-warn); backend apps use this directly
- `@toku/eslint-config/react` — Vite React applications (browser globals, react + hooks plugins)

Usage in `eslint.config.js`:

```js
import { config } from "@toku/eslint-config/react";

export default config;
```
