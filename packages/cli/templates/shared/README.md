# {{projectName}}

Built with **Mix Framework** — Compiler-Native UI with Zero Virtual DOM, Fine-Grained Reactivity, Built-in RBAC/ABAC Permissions, and Offline CRDT State.

## Architecture Layout

```text
src/
├── layouts/          # Persistent shell layouts (<Outlet /> retains state across routes)
├── pages/            # Target page views bound to declarative routes
├── components/       # Reusable UI primitives
│   ├── common/       # Design system primitives (Button, Input, Modal, Card)
│   └── domain/       # Feature components (TaskItem, SyncStatusPill)
├── permissions/      # Native isomorphic RBAC/ABAC capability matrix
├── stores/           # Reactive signals and offline CRDT sync collections
├── styles/           # Global tokens, resets, and typography
├── routes.ts         # Declarative route configuration with pre-loader security
└── main.mix          # Application bootstrap and permission provider
```

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Build development output
npm run dev

# 3. Typecheck .tix and analyze .mix components
npm run check

# 4. Production build
npm run build
```
