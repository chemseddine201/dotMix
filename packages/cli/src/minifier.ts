/**
 * @dotmix/cli — bundle size report of `mix build`: every emitted module and asset, with gzip sizes.
 */

export interface BundleChunkInfo {
  readonly file: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly gzipBytes: number;
  readonly isEntry: boolean;
  readonly isDynamicEntry: boolean;
  readonly map?: string;
}

export interface BundleAssetInfo {
  readonly file: string;
  readonly sizeBytes: number;
  readonly gzipBytes: number;
}

export interface BundleSizeReport {
  readonly chunks: readonly BundleChunkInfo[];
  readonly assets: readonly BundleAssetInfo[];
  readonly totalBytes: number;
  readonly totalGzipBytes: number;
  readonly reportText: string;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

export function createBundleReport(
  chunks: readonly BundleChunkInfo[],
  assets: readonly BundleAssetInfo[]
): BundleSizeReport {
  let totalBytes = 0;
  let totalGzipBytes = 0;
  const reportLines: string[] = [
    "Bundle Size Report:",
    "----------------------------------------------------------------------",
    `${"Asset / Chunk".padEnd(38)} ${"Size".padStart(12)} ${"Gzip".padStart(14)}`,
    "----------------------------------------------------------------------"
  ];

  for (const chunk of chunks) {
    totalBytes += chunk.sizeBytes;
    totalGzipBytes += chunk.gzipBytes;
    const tag = chunk.isEntry ? " [entry]" : chunk.isDynamicEntry ? " [lazy]" : "";
    reportLines.push(
      `${(chunk.file + tag).padEnd(38)} ${formatKb(chunk.sizeBytes).padStart(12)} ${`gzip: ${formatKb(chunk.gzipBytes)}`.padStart(14)}`
    );
  }
  for (const asset of assets) {
    totalBytes += asset.sizeBytes;
    totalGzipBytes += asset.gzipBytes;
    reportLines.push(
      `${asset.file.padEnd(38)} ${formatKb(asset.sizeBytes).padStart(12)} ${`gzip: ${formatKb(asset.gzipBytes)}`.padStart(14)}`
    );
  }
  reportLines.push("----------------------------------------------------------------------");
  reportLines.push(
    `${"Total".padEnd(38)} ${formatKb(totalBytes).padStart(12)} ${`gzip: ${formatKb(totalGzipBytes)}`.padStart(14)}`
  );

  return {
    chunks,
    assets,
    totalBytes,
    totalGzipBytes,
    reportText: reportLines.join("\n")
  };
}
