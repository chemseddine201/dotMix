/* global module */
/**
 * mix-typescript-plugin
 *
 * Loaded by the TypeScript server through the dotMix VS Code extension. The TypeScript server
 * loads plugins with require(), so this file is CommonJS and has no dependencies.
 *
 * It resolves relative imports of .tix and .mix components to the component files, so that in
 * .ts files:
 *   - `import App from "./App.tix"` resolves to the real file (no "Cannot find module");
 *   - Ctrl+click on the import path opens the component;
 *   - Ctrl+click on the imported name opens the component at its `export default` line.
 *
 * TypeScript sees each component as a declaration with the same type as @dotmix/runtime/client:
 * a function from props to DOM nodes. The declaration keeps the line layout of the real file and
 * sits where `export default` is, so go-to-definition positions match the real source.
 */

const COMPONENT_EXTENSIONS = [".tix", ".mix"];
const COMPONENT_TYPE = "(props: Record<string, unknown>) => Node | readonly Node[]";
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

function isComponentFile(fileName) {
  const lowerCaseName = fileName.toLowerCase();
  return COMPONENT_EXTENSIONS.some((extension) => lowerCaseName.endsWith(extension));
}

/** Resolves `specifier` against the folder of `containingFile`. The TypeScript server uses "/" separators. */
function resolveRelativePath(containingFile, specifier) {
  const pathSegments = containingFile.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") pathSegments.pop();
    else pathSegments.push(segment);
  }
  return pathSegments.join("/");
}

/** Builds the declaration TypeScript reads for a component file, aligned with the real source text. */
function createComponentDeclaration(fileName, sourceText) {
  const fileBaseName = fileName.slice(fileName.lastIndexOf("/") + 1).replace(/\.(tix|mix)$/i, "");
  const declarationParts = [`declare const component: ${COMPONENT_TYPE};`, "export default component;"];
  if (IDENTIFIER_PATTERN.test(fileBaseName)) {
    declarationParts.push(`export { component as ${fileBaseName} };`);
  }
  const declarationText = declarationParts.join(" ");

  // Blank every character but keep the line breaks, so offsets map to the same lines.
  const blankedSource = sourceText.replace(/[^\r\n]/g, " ");
  const defaultExportOffset = Math.max(sourceText.indexOf("export default"), 0);
  return (
    blankedSource.slice(0, defaultExportOffset) +
    declarationText +
    blankedSource.slice(defaultExportOffset + declarationText.length)
  );
}

function init(modules) {
  const ts = modules.typescript;

  function create(info) {
    const host = info.languageServiceHost;

    const originalResolveModuleNameLiterals = host.resolveModuleNameLiterals;
    if (typeof originalResolveModuleNameLiterals === "function") {
      host.resolveModuleNameLiterals = (moduleLiterals, containingFile, ...resolverArguments) => {
        const resolutions = originalResolveModuleNameLiterals.call(host, moduleLiterals, containingFile, ...resolverArguments);
        return resolutions.map((resolution, literalIndex) => {
          const specifier = moduleLiterals[literalIndex].text;
          if (resolution.resolvedModule || !specifier.startsWith(".") || !isComponentFile(specifier)) {
            return resolution;
          }
          const componentFile = resolveRelativePath(containingFile, specifier);
          if (!ts.sys.fileExists(componentFile)) {
            return resolution;
          }
          return {
            resolvedModule: {
              resolvedFileName: componentFile,
              extension: ts.Extension.Ts,
              isExternalLibraryImport: false,
              resolvedUsingTsExtension: false,
            },
          };
        });
      };
    }

    const originalGetScriptSnapshot = host.getScriptSnapshot;
    host.getScriptSnapshot = (fileName) => {
      // Always read through the original host first: it registers the file with the server.
      const sourceSnapshot = originalGetScriptSnapshot.call(host, fileName);
      if (!sourceSnapshot || !isComponentFile(fileName)) {
        return sourceSnapshot;
      }
      const sourceText = sourceSnapshot.getText(0, sourceSnapshot.getLength());
      return ts.ScriptSnapshot.fromString(createComponentDeclaration(fileName, sourceText));
    };

    const originalGetScriptKind = host.getScriptKind;
    host.getScriptKind = (fileName) => {
      if (isComponentFile(fileName)) return ts.ScriptKind.TS;
      return typeof originalGetScriptKind === "function" ? originalGetScriptKind.call(host, fileName) : ts.ScriptKind.Unknown;
    };

    return info.languageService;
  }

  return { create };
}

module.exports = init;
