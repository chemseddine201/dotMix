# dotMix (Mix & Tix) for Visual Studio Code

Official Visual Studio Code extension providing first-class language support for **dotMix** (`.mix`) and **dotTix** (`.tix`) components.

dotMix is an independent ahead-of-time (AOT) UI framework that compiles declarative templates directly to surgical, fine-grained DOM operations with zero Virtual DOM overhead.

---

## Installation

The extension is not on the Marketplace yet. Build and install it from the dotMix repository:

```bash
# At the repository root
npm install
npm run build

# Package and install
cd editors/vscode-mix
npm run package
code --install-extension vscode-mix-0.2.0.vsix --force
```

Then run **Developer: Reload Window**. TypeScript projects also need `src/env.d.ts` with `/// <reference types="@dotmix/runtime/client" />` (`mix create --ts` adds it).

Details: [INSTALL.md](./INSTALL.md) and the [full guide](https://github.com/chemseddine201/dotMix/blob/master/docs/VSCODE_EXTENSION_GUIDE.md).

---

## 🚀 Features

- **Rich Syntax Highlighting**:
  - Full support for both modern **Functional Components** (`export default function MyComp(props: Props) { ... return ( ... ); }`) and traditional Single-File Components (`<script>`, `<template>`, `<style>`).
  - First-class syntax coloring for clean control-flow blocks (`{if}`, `{elseif}`, `{else}`, `{endif}`, `{each ... in ...}`, `{endeach}`, `{await ...}`, `{then ...}`, `{catch ...}`, `{endawait}`).
  - Dynamic elements (`<$tagName>`, `</$tagName>`, `<$tagName />`, `<${expr}>`).
  - Built-in framework components (`<Can>`, `<RouterView>`, `<Link>`, `<Outlet>`, `<Teleport>`, `<KeepAlive>`, `<Transition>`).
  - Two-way form and directive bindings (`bind:value`, `bind:checked`, `class:*`, `style:*`, `on:*`, `@event`).
  - Embedded CSS / SCSS / Less scoping within `<style>` blocks.

- **Live Diagnostics (Semantic & Typecheck)**:
  - Real-time background compilation errors and warnings as you type.
  - Full TypeScript 6 Compiler API type verification for `.tix` component props, generics, and imports against actual `.d.ts` declaration files.
  - Zero false positives; diagnostics map directly to original source spans (`file:line:col`).

- **IntelliSense & Autocompletions**:
  - In-scope reactive bindings (`signal`, `computed`, `effect`, props, functions).
  - Lexical loop item and index completions inside `{each (item, idx) in list}` blocks.
  - Resolved promise data completions inside `{await} {then result}` and `{catch error}` branches.
  - Automatic CSS class suggestions from embedded `<style>`, linked stylesheets (`<style src="./theme.css" />`), and imported `.css`/`.scss`/`.less` files.
  - Framework keywords and directive snippets with interactive tabstops.

- **Hover Tooltips**:
  - Rich Markdown documentation when hovering over reactive bindings, signals, computeds, and component props.

- **Go-To-Definition (F12)**:
  - Jump directly from component tags (`<MetricCard />`) or import statements (`import MetricCard from "./MetricCard.tix"`) to their target source files.
  - Jump from template identifier references to their original declaration in the component scope.
  - Imports written with `.js` (the NodeNext convention, e.g. `./navigation.js`) open their source file (`navigation.ts`).
  - In `.ts` files, the bundled TypeScript plugin resolves `.tix` and `.mix` imports: no `Cannot find module` errors, and Ctrl+click on the import path or on the imported name opens the component.

- **Productive Snippets**:
  - `tix-comp`: Scaffold a dotMix Functional Component with TypeScript Props interface.
  - `mix-comp`: Scaffold a dotMix Functional Component in JavaScript.
  - `mix-sfc`: Scaffold a traditional Single-File Component (`<script>`, template, `<style>`).
  - `mix-signal`: Create a reactive `signal` (imported automatically).
  - `mix-computed`: Create a derived `computed` value (imported automatically).
  - `mix-effect`: Create a reactive `createEffect` side effect.
  - `mix-if`, `mix-ifelse`, `mix-ifelseif`: Clean curly control-flow blocks.
  - `mix-each`: `{each (item, idx) in list}` iteration block.
  - `mix-await`: `{await promise} ... {then data} ... {catch error}` async block.
  - `mix-can`: `<Can I="..." this={...}>` reactive permission gate.
  - `mix-dyn`: `<$tagName>` dynamic element tag.

---

## ⚙️ Extension Settings

This extension contributes the following settings:

| Setting | Default | Description |
| :--- | :---: | :--- |
| `mix.diagnostics.enable` | `true` | Enable live semantic and TypeScript 6 typecheck diagnostics for `.mix` and `.tix` files. |
| `mix.hover.enable` | `true` | Enable rich Markdown hover tooltips for reactive symbols, signals, and props. |
| `mix.completions.enable` | `true` | Enable IntelliSense autocomplete suggestions for symbols, control flow, and CSS classes. |
| `mix.trace.server` | `"off"` | Trace communication between VS Code and the dotMix language service (`"off"`, `"messages"`, `"verbose"`). |

---

## ⌨️ Commands

Access via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **`dotMix: Restart Language Server`** (`mix.restartServer`):
  Re-indexes the entire workspace and re-evaluates diagnostics across all open editors.
- **`dotMix: Run Type & Semantic Diagnostics Check`** (`mix.checkWorkspace`):
  Performs a complete validation scan across all `.mix` and `.tix` files in the workspace and populates the Problems panel.
- **`dotMix: Show Output Channel`** (`mix.showOutput`):
  Reveals the dotMix Language Support log output channel.

---

## 🛠️ Local Development & Testing

```bash
# Compile the extension
npm run build

# Or compile vscode-mix specifically
cd editors/vscode-mix
npm run build

# Run unmocked test suite
npm test
```

To test the extension live in VS Code:
1. Open this repository in VS Code.
2. Press `F5` (or run **Extension** launch configuration) to open an Extension Development Host window.
3. Open any `.mix` or `.tix` file to enjoy full language support, syntax highlighting, diagnostics, hover, and autocompletions!

---

## 📄 License

MIT © 2026 dotMix Framework Authors.
