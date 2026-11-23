/**
 * @dotmix/image — Responsive <Picture> component with intrinsic dimensions,
 * safe srcset validation, and zero-network placeholder mode.
 */

import {
  createElement,
  insertNode,
  setAttribute,
  setSafeSrcset,
  validateSafeUrl
} from "@dotmix/runtime";

export type ImageFormat = "avif" | "webp" | "jpeg" | "png";

export interface PictureProps {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly widths?: readonly number[] | undefined;
  readonly formats?: readonly ImageFormat[] | undefined;
  readonly sizes?: string | undefined;
  readonly loading?: "lazy" | "eager" | undefined;
  readonly decoding?: "async" | "sync" | "auto" | undefined;
  readonly fetchpriority?: "high" | "low" | "auto" | undefined;
  readonly placeholder?: boolean | "box" | undefined;
  readonly class?: string | undefined;
  readonly style?: string | Readonly<Record<string, string>> | undefined;
}

export interface ImageBuildManifestEntry {
  readonly src: string;
  readonly intrinsicWidth: number;
  readonly intrinsicHeight: number;
  readonly sources: readonly {
    readonly format: ImageFormat;
    readonly type: string;
    readonly srcset: string;
  }[];
  readonly fallbackSrc: string;
}

export type ImageBuildManifest = Readonly<Record<string, ImageBuildManifestEntry>>;

let activeImageManifest: ImageBuildManifest = {};

export function setImageManifest(manifest: ImageBuildManifest): void {
  activeImageManifest = { ...manifest };
}

export function getImageManifest(): ImageBuildManifest {
  return activeImageManifest;
}

function escapeHtmlAttr(val: string): string {
  return val
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function styleToString(style: string | Readonly<Record<string, string>> | undefined): string {
  if (!style) return "";
  if (typeof style === "string") return style;
  return Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

export function Picture(props: PictureProps): Node | string {
  const width = Math.max(1, Math.round(props.width));
  const height = Math.max(1, Math.round(props.height));
  const isPlaceholder = props.placeholder === true || props.placeholder === "box";

  if (!isPlaceholder) {
    validateSafeUrl(props.src);
  }

  const baseClass = props.class ? `mix-picture ${props.class}` : "mix-picture";

  if (isPlaceholder) {
    const cls = props.class ? `mix-picture-placeholder ${props.class}` : "mix-picture-placeholder";
    const extraStyle = props.style ? styleToString(props.style) : "";

    if (typeof document === "undefined") {
      const styleAttr = extraStyle ? ` style="${escapeHtmlAttr(extraStyle)}"` : "";
      return `<svg class="${escapeHtmlAttr(cls)}" role="img" aria-label="${escapeHtmlAttr(props.alt)}" data-mix-placeholder="true" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${styleAttr}><rect width="${width}" height="${height}" fill="none" /></svg>`;
    }

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    setAttribute(svg, "class", cls);
    setAttribute(svg, "role", "img");
    setAttribute(svg, "aria-label", props.alt);
    setAttribute(svg, "data-mix-placeholder", "true");
    setAttribute(svg, "width", String(width));
    setAttribute(svg, "height", String(height));
    setAttribute(svg, "viewBox", `0 0 ${width} ${height}`);
    if (extraStyle) {
      setAttribute(svg, "style", extraStyle);
    }
    const rect = document.createElementNS(svgNs, "rect");
    rect.setAttribute("width", String(width));
    rect.setAttribute("height", String(height));
    rect.setAttribute("fill", "none");
    svg.appendChild(rect);
    return svg;
  }

  const manifestEntry = activeImageManifest[props.src];
  const fallbackSrc = manifestEntry?.fallbackSrc ?? props.src;
  validateSafeUrl(fallbackSrc);
  const sizes = props.sizes ?? "100vw";
  const loading = props.loading ?? "lazy";
  const decoding = props.decoding ?? "async";
  const fetchpriority = props.fetchpriority;
  const sources = manifestEntry?.sources ?? [];

  if (typeof document === "undefined") {
    const sourceTags = sources
      .map(
        (s) =>
          `<source type="${escapeHtmlAttr(s.type)}" srcset="${escapeHtmlAttr(s.srcset)}" sizes="${escapeHtmlAttr(sizes)}" />`
      )
      .join("");
    const fpAttr = fetchpriority ? ` fetchpriority="${escapeHtmlAttr(fetchpriority)}"` : "";
    const styleAttr = props.style ? ` style="${escapeHtmlAttr(styleToString(props.style))}"` : "";
    return `<picture class="${escapeHtmlAttr(baseClass)}">${sourceTags}<img src="${escapeHtmlAttr(fallbackSrc)}" width="${width}" height="${height}" alt="${escapeHtmlAttr(props.alt)}" loading="${escapeHtmlAttr(loading)}" decoding="${escapeHtmlAttr(decoding)}"${fpAttr}${styleAttr} /></picture>`;
  }

  const pictureEl = createElement("picture");
  setAttribute(pictureEl, "class", baseClass);

  for (const s of sources) {
    const sourceEl = createElement("source");
    setAttribute(sourceEl, "type", s.type);
    setSafeSrcset(sourceEl, s.srcset);
    setAttribute(sourceEl, "sizes", sizes);
    insertNode(pictureEl, sourceEl);
  }

  const imgEl = createElement("img");
  setAttribute(imgEl, "src", fallbackSrc);
  setAttribute(imgEl, "width", String(width));
  setAttribute(imgEl, "height", String(height));
  setAttribute(imgEl, "alt", props.alt);
  setAttribute(imgEl, "loading", loading);
  setAttribute(imgEl, "decoding", decoding);
  if (fetchpriority) {
    setAttribute(imgEl, "fetchpriority", fetchpriority);
  }
  if (props.style) {
    setAttribute(imgEl, "style", props.style);
  }
  insertNode(pictureEl, imgEl);

  return pictureEl;
}
