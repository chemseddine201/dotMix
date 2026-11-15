# dotMix VS Code Extension Installation & Setup Guide

This guide walks you through installing and configuring the official Visual Studio Code extension for **dotMix** (`.mix`) and **dotTix** (`.tix`) components.

---

## Install

### Method 1: Package and install a `.vsix` (recommended)

The package contains everything the extension needs at run time: the compiled extension, `@dotmix/language-server` with its dependencies, and the TypeScript plugin that handles `.tix` and `.mix` imports in `.ts` files.

```bash
# 1. At the repository root
npm install
npm run build

# 2. Package the extension (writes vscode-mix-<version>.vsix)
cd editors/vscode-mix
npm run package

# 3. Install it, replacing any older version
code --install-extension vscode-mix-0.1.0.vsix --force
```

Then run **Developer: Reload Window** (Ctrl+Shift+P, or Cmd+Shift+P on macOS). You can also install the file from the Extensions view: `...` menu → **Install from VSIX...**.

Do not package with `npx @vscode/vsce package --no-dependencies`: that command leaves out `node_modules`, so the extension cannot load its language server and only syntax highlighting works.

### Method 2: Run from source (no installation, for extension development)

```bash
# At the repository root, after npm install and npm run build
npm run build --prefix editors/vscode-mix
code --extensionDevelopmentPath="$PWD/editors/vscode-mix" examples/showcase
```

This opens an **Extension Development Host** window running the extension from `editors/vscode-mix/dist`. The TypeScript plugin is only loaded from an installed `.vsix` (Method 1), so in this mode `.ts` files rely on `src/env.d.ts` alone.

### TypeScript projects

So that `.ts` files accept component and stylesheet imports, the project needs one declaration file. `mix create --ts` adds it; in an existing project create it:

```ts
// src/env.d.ts
/// <reference types="@dotmix/runtime/client" />
```

---

## How to Verify the Installation

1. Open a `.tix` file, for example `examples/showcase/src/layouts/ShowcaseLayout.tix`.
2. Check:
   - **Status bar**: the language mode in the bottom-right shows **Tix** (or **Mix** for `.mix` files).
   - **Syntax highlighting**: tags, directives and control-flow blocks (`{if}`, `{each}`, `{await}`) are coloured.
   - **Go to definition**: Ctrl+click `<NavSection />` to open `NavSection.tix`, and Ctrl+click `buildNavigation` to open `navigation.ts`.
3. Open `examples/showcase/src/routes.ts`:
   - no `Cannot find module` errors on the `.tix` imports;
   - Ctrl+click on `"./pages/start/HomePage.tix"` or on `HomePage` opens the page component.

---

## ⌨️ Extension Commands

Open the Command Palette (`Ctrl+Shift+P` on Windows/Linux, `Cmd+Shift+P` on macOS) and run:

| Command | Action |
| :--- | :--- |
| **`dotMix: Restart Language Server`** | Re-indexes all workspace `.mix`, `.tix`, and `.css` files and updates diagnostics. |
| **`dotMix: Run Type & Semantic Diagnostics Check`** | Performs a full scan of all components in the workspace and populates the Problems panel. |
| **`dotMix: Show Output Channel`** | Displays the dotMix Language Support log stream. |

---

## ⚙️ Configuration Settings

Customize behavior in VS Code `settings.json`:

```json
{
  "mix.diagnostics.enable": true,
  "mix.hover.enable": true,
  "mix.completions.enable": true,
  "mix.trace.server": "off"
}
```

---

## 🛠️ Uninstallation

If you ever need to remove the linked extension:

```powershell
# Windows
cmd /c rmdir "$HOME\.vscode\extensions\mix-framework.vscode-mix"

# macOS / Linux
rm "$HOME/.vscode/extensions/mix-framework.vscode-mix"
```
Then reload your VS Code window.

