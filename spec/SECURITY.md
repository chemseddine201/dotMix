# Security Specification — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Security Specification (Reconciled Phase Gate 1)  
**Applies to:** Compiler Codegen (`@mix/compiler-codegen`) and Runtime (`@mix/runtime`)  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Threat Model & Security Boundaries

Mix / Tix compiles templates ahead-of-time to direct DOM operations, inherently eliminating classic Virtual DOM innerHTML injection risks for ordinary elements. Specific threat surfaces are governed by explicit runtime security boundaries:

1. **Unescaped HTML Bindings:** `mix-html` directives.
2. **Dynamic CSS & Style Bindings:** CSS property and URL injection.
3. **Responsive Image Attribute (`srcset`):** URL splitting vulnerabilities.
4. **URL Navigation & Resource Fetching:** Protocol smuggling (`javascript:`, `vbscript:`).

---

## 2. Normative WHATWG `srcset` Parsing Algorithm (D-107)

Simplified regex splitting by comma is strictly prohibited because data URIs and complex query parameters legitimately contain commas.

### 2.1 Conforming Algorithm (HTML Standard §4.8.4.3.7)
1. **Input:** The raw `srcset` attribute string.
2. **Scanner Loop:** Initialize pointer at index 0. While pointer < length:
   - Skip ASCII whitespace (`U+0009`, `U+000A`, `U+000C`, `U+000D`, `U+0020`).
   - If pointer == length, return collected candidates.
   - Collect candidate URL substring:
     - Read non-whitespace characters. If a comma `,` is encountered within a valid URL scheme or parenthetical/data-payload context, it does not terminate the URL unless followed by whitespace.
   - Collect descriptors:
     - After candidate URL, skip whitespace.
     - Parse comma-delimited descriptors: width (`<positive-integer>w`) or density (`<positive-number>x`).
     - Error recovery: If a descriptor is invalid or duplicate, discard the candidate without aborting subsequent candidates.
3. **Validation:** Validate each candidate URL against the safe protocol allowlist before committing to the DOM attribute.

### 2.2 Mandatory Conformance Test Vectors
- Basic candidate with density: `"image-1x.jpg 1x, image-2x.jpg 2x"`
- Candidates with width descriptors: `"banner-400w.jpg 400w, banner-800w.jpg 800w"`
- Data URLs containing commas: `"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA... 1x, image-2x.jpg 2x"`
- Query strings with commas: `"https://example.com/cdn?format=jpg,webp&q=80 1x"`
- Irregular whitespace: `"\n  image.jpg\t 1x\n , \timage-hd.jpg 2x  "`
- Malformed descriptors: `"img1.jpg invalid-descriptor, img2.jpg 2x"` (recovers and emits `img2.jpg`).

---

## 3. Trusted HTML Boundary & Sanitizer Provider (D-109 / HAA-03)

### 3.1 Security Principle
TypeScript type branding (e.g. `type TrustedHTML = string & { __brand: "TrustedHTML" }`) is completely eliminated at runtime and provides **zero** protection against malicious input. Prototype/name checking (`constructor.name === "TrustedHTML"`) is strictly forbidden as it permits trivial forgery.

### 3.2 Runtime Sanitizer Contract
Direct HTML injection (`mix-html`) requires processing by an approved sanitizer:

1. **Root Application Authority:** The security boundary is configured at application root via `setSanitizerProvider(provider)`.
2. **Invocation:** `createTrustedHtml(dirtyHtml)` invokes the configured `SanitizerProvider` (or native W3C `window.trustedTypes` policy where supported).
3. **Private Registry:** Authentic instances are registered in a module-private `WeakSet<object>`.
4. **Prohibition of Caller Sanitizers:** The function `createTrustedHtml` does **not** accept an arbitrary caller-supplied sanitizer callback.
5. **Sink Enforcement:** Direct DOM sinks accept only verified objects from the `WeakSet`. Attempting to inject raw strings throws `MixError` (`MIX_SEC_FOREIGN_TRUSTED_HTML`).
6. **Context Restrictions:** Trusted HTML insertion into scriptable or active elements (`<script>`, `<iframe>`, `<object>`, `<embed>`) is unconditionally rejected (`MIX_SEC_HTML_CONTEXT`).
