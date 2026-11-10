/**
 * @mix/runtime/dom/styles — CSP nonce configuration and scoped stylesheet injection.
 */

let activeCspNonce: string | null = null;

export function setCspNonce(nonce: string | null): void {
  activeCspNonce = nonce;
}

export function getCspNonce(): string | null {
  return activeCspNonce;
}

export function injectStylesheet(
  id: string,
  cssText: string,
  options?: { nonce?: string | undefined }
): HTMLStyleElement | null {
  if (typeof document === "undefined" || !document.head) {
    return null;
  }
  const metaNonce =
    typeof document.querySelector === "function"
      ? document
          .querySelector('meta[property="csp-nonce"], meta[name="csp-nonce"]')
          ?.getAttribute("content") ?? null
      : null;
  const resolvedNonce = options?.nonce ?? activeCspNonce ?? metaNonce;
  const existing = document.head.querySelector(
    `style[data-mix-style="${id}"]`
  ) as HTMLStyleElement | null;
  if (existing) {
    if (resolvedNonce) {
      existing.setAttribute("nonce", resolvedNonce);
    }
    if (existing.textContent !== cssText) {
      existing.textContent = cssText;
    }
    return existing;
  }
  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-mix-style", id);
  if (resolvedNonce) {
    styleEl.setAttribute("nonce", resolvedNonce);
  }
  styleEl.textContent = cssText;
  document.head.appendChild(styleEl);
  return styleEl;
}
