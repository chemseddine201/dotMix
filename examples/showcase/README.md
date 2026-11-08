# Mix / Tix Showcase Application

A real-world, interactive demonstration application built entirely with **Mix & Tix** (`v1.0.0-rc.1`), illustrating the core architectural pillars:
- **Zero Virtual DOM:** Native, direct DOM operations emitted by AOT compilation.
- **Fine-Grained Reactivity (D-101):** Pull-Push reactive engine with deferred rerun scheduler.
- **Dynamic Elements (D-105):** `<{~expr}> ... </{~expr}>` syntax with evaluated-once resolved identity.
- **Strict CSS Sandboxing (D-108):** Scoped CSS transforms with escape decoding and injection defense.
- **Trusted Types Boundary (D-109):** `mix-html` directives enforced via `SanitizerProvider` and W3C Trusted Types policy.
- **Keyed Reconciliation (D-110):** Deterministic duplicate-key handling and atomic DOM commits.
- **Client-Side Routing:** Reactive SPA routing via `@mix/router`.

---

## Getting Started

### 1. Build the Showcase
Compile all `.mix` components to readable direct DOM JavaScript and scoped CSS:
```bash
npm run example:build
```

### 2. Verify Automatically
Run the simulated DOM end-to-end conformance test:
```bash
npm run example:verify
```

### 3. Launch Local Dev Server
Start the built-in, zero-dependency HTTP server:
```bash
npm run example
# or
npm run example:serve
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## Application Structure

```
examples/showcase/
├── src/
│   ├── App.mix           # Application shell & reactive view filter
│   ├── Header.mix        # Branding banner with logo and version
│   ├── Counter.mix       # Reactive counter with signals, methods & scoped CSS
│   ├── DynamicCard.mix   # Polymorphic <{~tag}> dynamic element
│   ├── TodoList.mix      # State management and reconciliation
│   ├── SecurityDemo.mix  # Trusted HTML (D-109) & safe dynamic styles (D-108)
│   └── main.js           # Client bootstrap, sanitizer registration & mounting
├── dist/                 # Pre-built direct DOM modules & bundle.css
├── build.mjs             # Showcase compilation script
├── server.mjs            # Zero-dependency local static HTTP server
├── verify.mjs            # Automated happy-dom test suite
├── index.html            # Native ESM HTML page with browser import maps
└── README.md
```

