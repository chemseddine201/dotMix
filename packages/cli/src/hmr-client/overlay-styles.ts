/**
 * @dotmix/cli/hmr-client/overlay-styles — Shadow DOM CSS for dev error overlay and warning badge.
 * Supports light/dark themes, RTL logical properties, and accessible focus indicators.
 */

export const OVERLAY_CSS = `
:host {
  --mix-bg: rgba(9, 9, 11, 0.82);
  --mix-card: #18181b;
  --mix-surface: #111114;
  --mix-border: #3f3f46;
  --mix-accent: #ef4444;
  --mix-accent-soft: rgba(239, 68, 68, 0.16);
  --mix-text: #f4f4f5;
  --mix-muted: #a1a1aa;
  --mix-code-active: rgba(239, 68, 68, 0.22);
  --mix-btn-bg: #27272a;
  --mix-btn-hover: #3f3f46;
  --mix-link: #93c5fd;
  --mix-warn-bg: #422006;
  --mix-warn-border: #eab308;
  --mix-warn-text: #fef08a;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  color-scheme: dark;
}
:host([data-theme="light"]) {
  --mix-bg: rgba(24, 24, 27, 0.55);
  --mix-card: #ffffff;
  --mix-surface: #f4f4f5;
  --mix-border: #d4d4d8;
  --mix-accent: #dc2626;
  --mix-accent-soft: rgba(220, 38, 38, 0.1);
  --mix-text: #18181b;
  --mix-muted: #52525b;
  --mix-code-active: rgba(220, 38, 38, 0.12);
  --mix-btn-bg: #e4e4e7;
  --mix-btn-hover: #d4d4d8;
  --mix-link: #1d4ed8;
  --mix-warn-bg: #fef9c3;
  --mix-warn-border: #ca8a04;
  --mix-warn-text: #713f12;
  color-scheme: light;
}
.backdrop {
  position: fixed;
  inset: 0;
  background: var(--mix-bg);
  z-index: 2147483640;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  backdrop-filter: blur(4px);
}
.dialog {
  background: var(--mix-card);
  color: var(--mix-text);
  border: 1px solid var(--mix-border);
  border-block-start: 4px solid var(--mix-accent);
  border-radius: 10px;
  max-width: 860px;
  width: 100%;
  max-height: 90vh;
  overflow: auto;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
  padding: 20px 24px;
  box-sizing: border-box;
}
.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-block-end: 12px;
}
.title-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.badge {
  background: var(--mix-accent-soft);
  color: var(--mix-accent);
  border: 1px solid var(--mix-accent);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}
.title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--mix-text);
}
.pager {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--mix-muted);
}
.file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-block-end: 10px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 13px;
  color: var(--mix-muted);
  direction: ltr;
}
.message {
  background: var(--mix-accent-soft);
  border-radius: 6px;
  padding: 12px 14px;
  margin: 0 0 14px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--mix-text);
}
.frame {
  background: var(--mix-surface);
  border: 1px solid var(--mix-border);
  border-radius: 6px;
  padding: 10px 0;
  margin-block-end: 14px;
  overflow-x: auto;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  direction: ltr;
  text-align: left;
}
.frame-line {
  display: flex;
  padding: 0 12px;
  white-space: pre;
}
.frame-line.active {
  background: var(--mix-code-active);
  font-weight: 600;
}
.ln {
  color: var(--mix-muted);
  min-width: 36px;
  text-align: right;
  padding-inline-end: 12px;
  user-select: none;
}
.caret-row {
  color: var(--mix-accent);
  font-weight: 700;
}
.stack-box {
  background: var(--mix-surface);
  border: 1px solid var(--mix-border);
  border-radius: 6px;
  padding: 10px 14px;
  margin-block-end: 14px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
}
.stack-label {
  color: var(--mix-muted);
  font-weight: 600;
  margin-block-end: 6px;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.stack-item {
  padding: 1px 0;
  color: var(--mix-text);
  direction: ltr;
  text-align: left;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.btn {
  background: var(--mix-btn-bg);
  color: var(--mix-text);
  border: 1px solid var(--mix-border);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.btn:hover { background: var(--mix-btn-hover); }
.btn:focus-visible { outline: 2px solid var(--mix-link); outline-offset: 2px; }
.docs-link {
  color: var(--mix-link);
  font-size: 13px;
  text-decoration: underline;
}
.warn-wrap {
  position: fixed;
  inset-block-end: 16px;
  inset-inline-end: 16px;
  z-index: 2147483635;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-width: 440px;
}
.warn-pill {
  background: var(--mix-warn-bg);
  color: var(--mix-warn-text);
  border: 1px solid var(--mix-warn-border);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0,0,0,0.25);
}
.warn-panel {
  background: var(--mix-card);
  color: var(--mix-text);
  border: 1px solid var(--mix-warn-border);
  border-radius: 8px;
  padding: 12px;
  width: 100%;
  max-height: 260px;
  overflow: auto;
  box-shadow: 0 12px 30px rgba(0,0,0,0.35);
  font-size: 12.5px;
}
.warn-item {
  padding: 6px 0;
  border-block-end: 1px solid var(--mix-border);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  white-space: pre-wrap;
}
.warn-item:last-child { border-block-end: none; }
`;

