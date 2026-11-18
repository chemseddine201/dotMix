/**
 * @dotmix/cli — Dev Server Module Dependency Graph & HMR Propagation
 *
 * Implements &:
 * - Records bidirectional importer/importedModule edges between served modules
 * - Tracks monotonic per-module version counters (?v=<n>)
 * - Computes update boundaries and full-reload decisions:
 *   - Component modules (.mix, .tix) and stylesheets are boundaries that contain updates
 *   - Helper modules (.js, .ts) propagate upwards to their importers
 *   - If propagation reaches root entry without a boundary, emits full-reload
 *   - Handles diamond dependencies without duplicate updates
 *   - Safely terminates on cyclic dependencies
 *   - Handles deleted modules cleanly
 */

import path from "node:path";
import { normalizeDriveLetter } from "./normalize-path.js";

export interface ModuleNode {
  readonly id: string;
  readonly file: string;
  readonly importers: Set<string>;
  readonly importedModules: Set<string>;
  version: number;
  isBoundary: boolean;
  isEntry: boolean;
}

export interface PropagationResult {
  readonly type: "update" | "full-reload";
  readonly boundaries: string[];
  readonly reason?: string;
}

export class ModuleGraph {
  readonly rootDir: string;
  private readonly nodes = new Map<string, ModuleNode>();

  constructor(rootDir: string) {
    this.rootDir = normalizeDriveLetter(path.normalize(path.resolve(rootDir)));
  }

  normalizeId(idOrPath: string): string {
    const clean = idOrPath.split("?")[0] ?? idOrPath;
    const normalized = normalizeDriveLetter(clean);
    // A file-system path inside the project becomes its root-relative id. On Linux and macOS an
    // absolute path starts with "/" like a module id, so containment decides, not the leading character.
    if (path.isAbsolute(normalized)) {
      const relativeToRoot = path.relative(this.rootDir, normalized);
      const isInsideRoot = relativeToRoot !== ""
        && relativeToRoot !== ".."
        && !relativeToRoot.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relativeToRoot);
      if (isInsideRoot) {
        return `/${relativeToRoot.split(path.sep).join("/")}`;
      }
    }
    const webPath = normalized.replace(/\\/g, "/");
    return webPath.startsWith("/") ? webPath : `/${webPath}`;
  }

  toAbsolutePath(id: string): string {
    const cleanId = id.split("?")[0] ?? id;
    const rel = cleanId.replace(/^\/+/, "");
    return normalizeDriveLetter(path.normalize(path.resolve(this.rootDir, rel)));
  }

  isBoundaryFile(fileId: string): boolean {
    const clean = fileId.toLowerCase();
    if (this.isEntryFile(clean)) {
      return false;
    }
    return (
      clean.endsWith(".mix") ||
      clean.endsWith(".tix") ||
      clean.endsWith(".css") ||
      clean.endsWith(".scss") ||
      clean.endsWith(".sass") ||
      clean.endsWith(".less")
    );
  }

  isEntryFile(fileId: string): boolean {
    const clean = fileId.toLowerCase();
    const basename = path.basename(clean);
    return (
      basename === "main.mix" ||
      basename === "main.tix" ||
      basename === "main.ts" ||
      basename === "main.js" ||
      basename === "index.html"
    );
  }

  getOrCreateNode(rawId: string): ModuleNode {
    const id = this.normalizeId(rawId);
    let node = this.nodes.get(id);
    if (!node) {
      const file = this.toAbsolutePath(id);
      node = {
        id,
        file,
        importers: new Set<string>(),
        importedModules: new Set<string>(),
        version: 0,
        isBoundary: this.isBoundaryFile(id),
        isEntry: this.isEntryFile(id)
      };
      this.nodes.set(id, node);
    }
    return node;
  }

  getNode(rawId: string): ModuleNode | undefined {
    return this.nodes.get(this.normalizeId(rawId));
  }

  addEdge(importerId: string, importedId: string): void {
    const importerNode = this.getOrCreateNode(importerId);
    const importedNode = this.getOrCreateNode(importedId);
    importerNode.importedModules.add(importedNode.id);
    importedNode.importers.add(importerNode.id);
  }

  removeEdge(importerId: string, importedId: string): void {
    const importer = this.getNode(importerId);
    const imported = this.getNode(importedId);
    if (importer) importer.importedModules.delete(this.normalizeId(importedId));
    if (imported) imported.importers.delete(this.normalizeId(importerId));
  }

  removeNode(rawId: string): void {
    const id = this.normalizeId(rawId);
    const node = this.nodes.get(id);
    if (!node) return;

    for (const importerId of node.importers) {
      const imp = this.nodes.get(importerId);
      if (imp) imp.importedModules.delete(id);
    }
    for (const importedId of node.importedModules) {
      const imp = this.nodes.get(importedId);
      if (imp) imp.importers.delete(id);
    }
    this.nodes.delete(id);
  }

  incrementVersion(rawId: string): number {
    const id = this.normalizeId(rawId);
    const visited = new Set<string>();
    const queue = [id];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);

      const node = this.getOrCreateNode(curr);
      node.version += 1;

      for (const imp of node.importers) {
        if (!visited.has(imp)) {
          queue.push(imp);
        }
      }
    }

    return this.getNode(id)?.version ?? 1;
  }

  computePropagation(changedIdInput: string): PropagationResult {
    const changedId = this.normalizeId(changedIdInput);
    const startNode = this.nodes.get(changedId);

    // If starting node is already a boundary, update it directly
    if (startNode && startNode.isBoundary) {
      return {
        type: "update",
        boundaries: [startNode.id]
      };
    }

    // Traverse upwards along importer edges
    const boundaries = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = startNode ? Array.from(startNode.importers) : [];

    // If a module has no importers at all (or is entry) and is not a boundary:
    if (queue.length === 0) {
      return {
        type: "full-reload",
        boundaries: [],
        reason: `Module ${changedId} has no boundary importers to absorb update`
      };
    }

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) {
        return {
          type: "full-reload",
          boundaries: [],
          reason: `Unknown importer node ${currentId}`
        };
      }

      if (node.isBoundary) {
        boundaries.add(node.id);
      } else if (node.isEntry) {
        return {
          type: "full-reload",
          boundaries: [],
          reason: `Update reached root entry ${node.id} without boundary`
        };
      } else {
        if (node.importers.size === 0) {
          return {
            type: "full-reload",
            boundaries: [],
            reason: `Orphan non-boundary module ${node.id} reached`
          };
        }
        for (const impId of node.importers) {
          if (!visited.has(impId)) {
            queue.push(impId);
          }
        }
      }
    }

    if (boundaries.size === 0) {
      return {
        type: "full-reload",
        boundaries: [],
        reason: `No boundaries found along update path for ${changedId}`
      };
    }

    return {
      type: "update",
      boundaries: Array.from(boundaries)
    };
  }
}
