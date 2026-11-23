/**
 * @dotmix/image/build — Build-time image optimizer (AVIF, WebP, fallback) using optional `sharp`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DiagnosticCodes, MixError } from "@dotmix/runtime";
import type { ImageBuildManifest, ImageFormat } from "./index.js";

export interface ImageBuildInput {
  readonly src: string;
  readonly widths?: readonly number[] | undefined;
  readonly formats?: readonly ImageFormat[] | undefined;
}

export interface OptimizeImagesOptions {
  readonly projectDirectory: string;
  readonly outDir: string;
  readonly basePath?: string | undefined;
  readonly widths?: readonly number[] | undefined;
  readonly formats?: readonly ImageFormat[] | undefined;
  readonly quality?: number | undefined;
  readonly cacheDir?: string | undefined;
}

interface SharpPipeline {
  metadata(): Promise<{ width?: number; height?: number }>;
  resize(width: number): SharpPipeline;
  avif(opts: { quality: number }): SharpPipeline;
  webp(opts: { quality: number }): SharpPipeline;
  jpeg(opts: { quality: number }): SharpPipeline;
  png(opts: { quality: number }): SharpPipeline;
  toBuffer(): Promise<Buffer>;
}

type SharpFactory = (input: Buffer) => SharpPipeline;

const MIME_BY_FORMAT: Readonly<Record<ImageFormat, string>> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png"
};

async function loadSharp(): Promise<SharpFactory | null> {
  try {
    const modName = "sharp";
    const loaded = (await import(modName)) as { default?: SharpFactory };
    return typeof loaded.default === "function" ? loaded.default : null;
  } catch {
    return null;
  }
}

export async function optimizeProjectImages(
  inputs: readonly ImageBuildInput[],
  options: OptimizeImagesOptions
): Promise<ImageBuildManifest> {
  if (inputs.length === 0) {
    return {};
  }

  const sharp = await loadSharp();
  if (!sharp) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_IMAGE_PROCESSOR_MISSING,
      "Image optimization requires the optional peer dependency 'sharp'. Install it with `npm install sharp` or use placeholder mode on <Picture>."
    );
  }

  const basePath = options.basePath ?? "/";
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const defaultWidths = options.widths ?? [400, 800, 1200, 1600];
  const defaultFormats = options.formats ?? ["avif", "webp", "jpeg"];
  const quality = options.quality ?? 80;
  const imgOutDir = path.join(options.outDir, "assets", "img");
  fs.mkdirSync(imgOutDir, { recursive: true });
  if (options.cacheDir) {
    fs.mkdirSync(options.cacheDir, { recursive: true });
  }

  const manifest: Record<string, ImageBuildManifest[string]> = {};

  for (const item of inputs) {
    const relPath = item.src.startsWith("/") ? item.src.slice(1) : item.src;
    const candidates = [
      path.resolve(options.projectDirectory, "public", relPath),
      path.resolve(options.projectDirectory, "src", relPath),
      path.resolve(options.projectDirectory, relPath)
    ];
    const sourceFile = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
    if (!sourceFile) {
      throw new MixError(
        DiagnosticCodes.MIX_ERR_STATIC_BUILD,
        `Image source "${item.src}" not found in project public/, src/, or root.`
      );
    }

    const rawBuf = fs.readFileSync(sourceFile);
    const sourceHash = crypto.createHash("sha256").update(rawBuf).digest("hex").slice(0, 8);
    const meta = await sharp(rawBuf).metadata();
    const intrinsicWidth = meta.width ?? 1200;
    const intrinsicHeight = meta.height ?? 800;
    const baseName = path.basename(sourceFile, path.extname(sourceFile));

    const targetWidths = (item.widths ?? defaultWidths).filter((w) => w <= intrinsicWidth);
    if (targetWidths.length === 0) {
      targetWidths.push(intrinsicWidth);
    }
    const targetFormats = item.formats ?? defaultFormats;
    const sources: Array<{ format: ImageFormat; type: string; srcset: string }> = [];
    let fallbackSrc = item.src;

    for (const format of targetFormats) {
      const srcsetEntries: string[] = [];
      for (const w of targetWidths) {
        const outFilename = `${baseName}-${w}w-${sourceHash}.${format === "jpeg" ? "jpg" : format}`;
        const outDiskPath = path.join(imgOutDir, outFilename);
        const cacheDiskPath = options.cacheDir ? path.join(options.cacheDir, outFilename) : null;

        if (!fs.existsSync(outDiskPath)) {
          if (cacheDiskPath && fs.existsSync(cacheDiskPath)) {
            fs.copyFileSync(cacheDiskPath, outDiskPath);
          } else {
            let pipeline = sharp(rawBuf).resize(w);
            if (format === "avif") pipeline = pipeline.avif({ quality });
            else if (format === "webp") pipeline = pipeline.webp({ quality });
            else if (format === "png") pipeline = pipeline.png({ quality });
            else pipeline = pipeline.jpeg({ quality });
            const encoded = await pipeline.toBuffer();
            fs.writeFileSync(outDiskPath, encoded);
            if (cacheDiskPath) {
              fs.writeFileSync(cacheDiskPath, encoded);
            }
          }
        }

        const publicUrl = `${normalizedBase}assets/img/${outFilename}`;
        srcsetEntries.push(`${publicUrl} ${w}w`);
        if (format === "jpeg" || format === "png") {
          fallbackSrc = publicUrl;
        }
      }
      sources.push({
        format,
        type: MIME_BY_FORMAT[format],
        srcset: srcsetEntries.join(", ")
      });
    }

    manifest[item.src] = {
      src: item.src,
      intrinsicWidth,
      intrinsicHeight,
      sources,
      fallbackSrc
    };
  }

  return manifest;
}

