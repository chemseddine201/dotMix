# Mix/Tix Instant Hot Updates (HMR) Specification (Proposal)

**Authority:** Human Architecture Authority  
**Phase:** Gate 36  
**Status:** Proposal (Governed by HAA-12 / D-151..D-156)  
**Applies to:** `@dotmix/cli`, `@dotmix/runtime`, `@dotmix/compiler-codegen`, `@dotmix/compiler-css`, `@dotmix/vite-plugin`

---

## 1. Architectural Principles

Mix HMR delivers sub-100ms updates to running applications while preserving component state, fine-grained reactive subscriptions, and DOM identity:

1. **Transactional Swaps (D-151):** Re-rendered components are staged off-DOM. If an exception occurs during instantiation, the swap is aborted, existing DOM and signal subscriptions are preserved, and an error is presented in the isolated error overlay.
2. **Deterministic Boundary Propagation (D-152):** Non-boundary module edits (e.g. Pure JS helpers) traverse upward along importer edges to the nearest boundary. If an update reaches the root entry without an absorbing boundary, a full reload is triggered.
3. **Monotonic Sequence & Zero-Leak Transport (D-153):** Dev updates are streamed over Server-Sent Events (`/__mix_hmr`) with monotonically increasing sequence numbers, 15-second heartbeats, client-side acknowledgments (`POST /__mix_hmr/ack`), and server restart detection via ephemeral server IDs.
4. **Stable CSS Scoping (D-154):** In HMR mode, the CSS scoping attribute hash (`data-mix-<hash>`) is seeded deterministically from the file path. CSS edits update existing `<style>` tags in-place without generating duplicate tags or altering DOM scope attributes.
5. **Resilient Error Overlay (D-155):** Compilation and runtime errors are isolated in a Shadow DOM overlay (`<mix-error-overlay>`). Errors never trigger automatic page reloads or wipe application state.
6. **Production Purity & Zero Idle Work (D-156):** When `hmr: false`, the compiler and runtime emit zero HMR trampolines, boundaries, or shims. The dev watcher operates entirely event-driven with 0 idle file reads.

---

## 2. Dev Server Transport Protocol

### 2.1 SSE Endpoint: `GET /__mix_hmr`

The server pushes JSON-encoded events prefixed with `data: `:

- **`connected`**: Emitted on connection establishment with `{ serverId: string, seq: number }`.
- **`update`**: Emitted on file modification with `{ file: string, timestamp: number, cssUpdated: boolean, kind?: "js" | "css", seq: number }`.
- **`full-reload`**: Emitted when propagation reaches root without boundary with `{ reason: string, timestamp: number, seq: number }`.
- **`error`**: Emitted on compilation failure with `{ error: { code, message, file, line, column, frame }, seq: number }`.
- **`error-cleared`**: Emitted when a previously failing file compiles successfully with `{ file: string, seq: number }`.
- **Heartbeat**: A comment line `: heartbeat\n\n` emitted every 15 seconds.

### 2.2 Client Acknowledgment: `POST /__mix_hmr/ack`

The client replies with confirmation:
```json
{
  "seq": 42,
  "ok": true,
  "durationMs": 35.2
}
```

---

## 3. Runtime Component Swap & State Retention

Component instances are bounded in DOM by comment markers:
```html
<!--mix:hmr-start:/src/App.mix#1::/src/Counter.mix#counter-1-->
<div class="counter-box">...</div>
<!--mix:hmr-end:/src/App.mix#1::/src/Counter.mix#counter-1-->
```

Upon hot update:
1. Signal values are snapshotted from the active instance into a state-transfer store keyed by composite instance keys.
2. The new component function is instantiated within a fresh reactive root off-DOM.
3. If successful, nodes between start and end markers are replaced, the previous reactive owner is disposed, and the instance registry is updated.
4. If instantiation throws, the new root is disposed and existing DOM remains untouched.

---

## 4. Performance Budgets (D-156)

| Metric | Target |
|---|---|
| Single-component edit | p95 $\le 100\text{ ms}$ |
| CSS-only edit | p95 $\le 50\text{ ms}$ |
| Idle file reads | Exactly $0$ reads |
| Production build overhead | Exactly $0$ bytes HMR code |

