# CSS Scoping & Style Validation — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical CSS Specification (Reconciled Phase Gate 1)  
**Package:** `@mix/compiler-css`  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Scoped CSS Model

Component styles declared within `<style>` blocks are automatically scoped by default:

```mix
<style>
  .btn {
    background-color: blue;
  }
</style>
```

The compiler transforms selectors by appending a unique component attribute selector:
```css
.btn[data-mix-c8f2a1] {
  background-color: blue;
}
```

---

## 2. Compile-Time CSS Validation (D-108)

During compilation, `@mix/compiler-css` tokenizes static stylesheet content using `css-tree@3.1.0` and enforces:

1. **Forbidden At-Rules Rejection:**
   - `@import` is strictly rejected with diagnostic error `MIX_ERR_CSS_FORBIDDEN_IMPORT`.
   - `@charset` is rejected with `MIX_ERR_CSS_FORBIDDEN_CHARSET`.
2. **Pseudo-Class Scoping Rules (F-05):**
   - `:global(...)` escapes component scoping for nested selectors.
   - `:deep(...)` targets descendant elements rendered by child components without breaking encapsulation boundaries.
   - The pseudo-class `:host` is **not** supported (Mix does not use Shadow DOM by default).
3. **Static Syntax Verification:**
   - Unbalanced braces, malformed selectors, or invalid static property declarations emit compile-time errors with character-exact source spans.

---

## 3. Runtime Dynamic CSS Validation (D-108)

Dynamic style bindings (`style={styles()}` or dynamic CSS variables `--custom-prop={val()}`) must be validated at runtime before application to DOM elements.

### 3.1 Property Name Validation
Dynamic property names must conform to valid CSS identifier grammar:
- Must match `/^[a-z][a-z0-9-]*$/i`.
- Any property name containing colons `:`, semicolons `;`, braces `{}`, or control characters is rejected with `MixError` (`MIX_SEC_CSS_PROPERTY`).

### 3.2 Value Validation & Escape Sequence Decoding
- Dynamic values are scanned for CSS escape sequences (e.g. `\3b` decoding to `;`, `\7d` decoding to `}`).
- Values containing unescaped or decoded property delimiters that could inject arbitrary CSS declarations are rejected.

### 3.3 Safe URL Protocols
If a dynamic style value includes `url(...)`:
- The enclosed URL is parsed and validated.
- Allowed protocols: `http:`, `https:`, relative paths (`/`, `./`, `../`), and safe raster image data URIs (`data:image/png;...`, `data:image/jpeg;...`, `data:image/webp;...`).
- Dangerous schemes (`javascript:`, `vbscript:`, or arbitrary executable schemes) and unverified scriptable formats (`data:image/svg+xml`) are rejected.

### 3.4 Safe Application Contract
Dynamic styles are **never** applied via raw HTML string concatenation (e.g. `<div style="...">`). The runtime applies validated properties individually using `element.style.setProperty(propertyName, value)`.
