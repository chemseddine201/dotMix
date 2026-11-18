# dotMix VS Code Extension: Install

```bash
# 1. At the repository root
npm install
npm run build

# 2. Package the extension (writes vscode-mix-<version>.vsix)
cd editors/vscode-mix
npm run package

# 3. Install it, replacing any older version
code --install-extension vscode-mix-0.2.0.vsix --force
```

Then run **Developer: Reload Window** in VS Code (Ctrl+Shift+P, or Cmd+Shift+P on macOS).

The `.vsix` contains the language server and the TypeScript plugin. Do not package with
`npx @vscode/vsce package --no-dependencies`: that leaves out `node_modules`, and the extension
then cannot start its language server.

TypeScript projects also need `src/env.d.ts` (created by `mix create --ts`):

```ts
/// <reference types="@dotmix/runtime/client" />
```

Full guide: [docs/VSCODE_EXTENSION_GUIDE.md](https://github.com/chemseddine201/dotMix/blob/master/docs/VSCODE_EXTENSION_GUIDE.md)
