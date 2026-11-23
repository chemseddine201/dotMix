# Decision Proposal D-187: Hash-Based CSP for Static Hosting & `_headers` Emission (P6)

**Status:** PROPOSED (Gate 39, Phase A — addresses Gap G7)  
**Target Packages:** `@dotmix/cli`  
**Related Decisions:** `D-109` (Security boundaries), `D-162` (`mix build`), `D-182` (Static Site Generation)  

---

## 1. Problem Statement

**Gap G7:** Dynamic SSR servers (`@dotmix/server-node`) emit per-request cryptographic CSP nonces. Static hosting platforms such as Cloudflare Pages serve pre-built HTML files from an edge CDN and cannot inject per-request nonces. Without build-time SHA-256 hash collection for emitted inline scripts (such as inline theme/RTL bootstrap scripts and `<script type="importmap">`) and inline styles, sites either fail strict CSP checks or fall back to unsafe `'unsafe-inline'`.

---

## 2. Options Considered

- **Option A:** Recommend `'unsafe-inline'` for static hosting.  
  *Rejected:* Weakens XSS protection and fails Best Practices / strict CSP audits.
- **Option B:** Require a Cloudflare Worker on every request to rewrite nonces.  
  *Rejected:* Adds runtime compute cost and latency to a pure static site.
- **Option C (Chosen):** Collect deterministic SHA-256 hashes of every inline `<script>` (including `<script type="importmap">`, excluding inert data blocks such as `application/ld+json` and `application/json`) and inline `<style>` block emitted per HTML file during `mix build`, write `dist/mix-csp.json`, and optionally emit a Cloudflare Pages `dist/_headers` file with strict CSP (`'self'` + exact `'sha256-...'` hashes), security headers, and cache rules.

---

## 3. Why This Design

- Zero runtime overhead; pure Node `node:crypto` SHA-256 hashing in `@dotmix/cli` (`D-159`).
- Supports inline no-flash dark-mode / theme bootstrap scripts in `index.html` without `'unsafe-inline'`.
- Handles `<script type="importmap">` correctly (browsers enforce `script-src` on import maps).
- Ignores `<script type="application/ld+json">` and `<script type="application/json">` data blocks, which are not executable scripts under CSP.

---

## 4. Public API (Exact Signatures)

### 4.1 `mix.config.ts` Schema (`@dotmix/cli`)

```ts
export interface CspConfig {
  readonly enabled?: boolean | undefined; // default: true on --static, emits dist/mix-csp.json
  readonly target?: "cloudflare-pages" | "manifest-only" | undefined; // default: "manifest-only"
  readonly scriptSrc?: readonly string[] | undefined; // extra allowed origins (never 'unsafe-inline' by default)
  readonly styleSrc?: readonly string[] | undefined;
  readonly imgSrc?: readonly string[] | undefined; // default: ["'self'", "data:"]
  readonly fontSrc?: readonly string[] | undefined; // default: ["'self'"]
  readonly connectSrc?: readonly string[] | undefined; // default: ["'self'"]
  readonly frameAncestors?: readonly string[] | undefined; // default: ["'none'"]
  readonly securityHeaders?: boolean | undefined; // HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
}
```

### 4.2 `dist/mix-csp.json` Schema & Helpers (`packages/cli/src/csp.ts`)

```ts
export interface CspRouteRecord {
  readonly route: string;
  readonly file: string;
  readonly scriptHashes: readonly string[]; // e.g. ["'sha256-...'"]
  readonly styleHashes: readonly string[];
  readonly policy: string;
}

export interface MixCspManifest {
  readonly version: "1.0";
  readonly algorithm: "sha256";
  readonly globalScriptHashes: readonly string[];
  readonly globalStyleHashes: readonly string[];
  readonly globalPolicy: string;
  readonly routes: Readonly<Record<string, CspRouteRecord>>;
}

export function computeCspSha256Hash(content: string): string;
export function extractInlineCspHashes(html: string): {
  readonly scriptHashes: readonly string[];
  readonly styleHashes: readonly string[];
};
export function buildCspPolicyString(
  scriptHashes: readonly string[],
  styleHashes: readonly string[],
  config?: CspConfig
): string;
export function writeCloudflareHeadersFile(
  outDir: string,
  manifest: MixCspManifest,
  config?: CspConfig
): string;
```

### Generated `dist/_headers` Baseline (when `target: "cloudflare-pages"`)
- `/assets/*` and content-hashed `/vendor/*` (`/vendor/<sha256-8>/@dotmix/...`): `Cache-Control: public, max-age=31536000, immutable`
- `/*` (HTML routes):
  - `Content-Security-Policy: <policy>` (or per-route blocks when route hashes differ)
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## 5. Verification Tests (Phase B)

1. **Hash Accuracy & JSON-LD Exclusion Test (`tests/static/csp-manifest.test.mjs`):** Build a static site containing an inline theme bootstrap `<script>`, a `<script type="importmap">`, an inline `<style>`, and a `<script type="application/ld+json">`. Assert `dist/mix-csp.json` includes exact SHA-256 hashes for the bootstrap script, import map, and inline style, and does **not** include `'unsafe-inline'` or hash `application/ld+json`.
2. **Cloudflare `_headers` Writer Test:** Enable `csp: { target: "cloudflare-pages" }`, run `mix build --static`, and verify `dist/_headers` contains valid `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and immutable `/assets/*` caching.
3. **Real-Browser CSP Enforcement Test:** Serve `dist/` over a local `node:http` server applying the headers parsed from `dist/_headers` and open the page in Chrome via `@dotmix/cli/browser`; attach a `securitypolicyviolation` listener and assert **0 violations** while the inline theme script and interactive island execute.

