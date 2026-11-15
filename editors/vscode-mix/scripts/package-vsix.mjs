// Packages the extension as a .vsix that runs on its own: the compiled extension, the TypeScript
// plugin and the full runtime dependency tree (@dotmix/language-server and what it needs) under
// extension/node_modules. `vsce --no-dependencies` cannot do this, because it always drops
// node_modules. No external tools: the .vsix is a plain zip archive written with node:zlib.
//
// Usage (from editors/vscode-mix): npm run package   ->   vscode-mix-<version>.vsix
/* global console */
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const extensionDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionManifest = JSON.parse(fs.readFileSync(path.join(extensionDirectory, "package.json"), "utf8"));
const TYPESCRIPT_PLUGIN_NAME = "mix-typescript-plugin";

// TypeScript ships compilers, servers and translations the language server never loads.
const UNUSED_TYPESCRIPT_FILE = /^(bin\/|lib\/[^/]+\/|lib\/(_?tsc|_?tsserver|tsserverlibrary|_?typingsInstaller|watchGuard)\b)/;
const UNUSED_FILE_SUFFIXES = [".map", ".tsbuildinfo"];

/** archive path -> absolute source path */
const archiveEntries = new Map();

function listFiles(directory) {
  const foundFiles = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) foundFiles.push(...listFiles(entryPath));
    else if (entry.isFile()) foundFiles.push(entryPath);
  }
  return foundFiles;
}

function toArchivePath(...segments) {
  return segments.join("/").split(path.sep).join("/");
}

function addFile(archivePath, sourcePath) {
  if (UNUSED_FILE_SUFFIXES.some((suffix) => archivePath.endsWith(suffix))) return;
  archiveEntries.set(archivePath, sourcePath);
}

function addDirectory(archiveDirectory, sourceDirectory, includeFile = () => true) {
  for (const sourceFile of listFiles(sourceDirectory)) {
    const relativePath = toArchivePath(path.relative(sourceDirectory, sourceFile));
    if (includeFile(relativePath)) addFile(`${archiveDirectory}/${relativePath}`, sourceFile);
  }
}

function findPackageDirectory(packageName, startDirectory) {
  let currentDirectory = startDirectory;
  for (;;) {
    const candidateDirectory = path.join(currentDirectory, "node_modules", ...packageName.split("/"));
    if (fs.existsSync(path.join(candidateDirectory, "package.json"))) return fs.realpathSync(candidateDirectory);
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(`Cannot find dependency "${packageName}". Run npm install at the repository root.`);
    }
    currentDirectory = parentDirectory;
  }
}

/** The files npm would publish: package.json, the "files" entries, README and LICENSE. */
function addPublishedPackage(packageName, packageDirectory) {
  const packageManifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
  const archiveDirectory = `extension/node_modules/${packageName}`;
  const publishedEntries = (packageManifest.files ?? []).filter((entry) => !entry.startsWith("!") && !entry.includes("*"));
  const excludedEntries = (packageManifest.files ?? []).filter((entry) => entry.startsWith("!") && !entry.includes("*")).map((entry) => entry.slice(1));
  const isPublished = (relativePath) => {
    if (packageName === "typescript" && UNUSED_TYPESCRIPT_FILE.test(relativePath)) return false;
    if (excludedEntries.some((excluded) => relativePath === excluded || relativePath.startsWith(`${excluded}/`))) return false;
    if (relativePath === "package.json" || /^(readme|license)/i.test(relativePath)) return true;
    if (publishedEntries.length === 0) return !relativePath.startsWith("node_modules/");
    return publishedEntries.some((entry) => relativePath === entry || relativePath.startsWith(`${entry.replace(/\/$/, "")}/`));
  };
  addDirectory(archiveDirectory, packageDirectory, isPublished);
  return packageManifest;
}

function addRuntimeDependencies() {
  const pendingPackages = Object.keys(extensionManifest.dependencies ?? {}).map((packageName) => ({ packageName, fromDirectory: extensionDirectory }));
  const addedPackages = new Map();
  while (pendingPackages.length > 0) {
    const { packageName, fromDirectory } = pendingPackages.shift();
    const packageDirectory = findPackageDirectory(packageName, fromDirectory);
    if (addedPackages.has(packageName)) {
      if (addedPackages.get(packageName) !== packageDirectory) {
        throw new Error(`Two different copies of "${packageName}" are needed; the flat node_modules layout cannot hold both.`);
      }
      continue;
    }
    addedPackages.set(packageName, packageDirectory);
    const packageManifest = addPublishedPackage(packageName, packageDirectory);
    for (const dependencyName of Object.keys(packageManifest.dependencies ?? {})) {
      pendingPackages.push({ packageName: dependencyName, fromDirectory: packageDirectory });
    }
  }
  return [...addedPackages.keys()];
}

function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function createVsixManifest() {
  const repositoryUrl = (extensionManifest.repository?.url ?? "").replace(/^git\+/, "");
  const languageTags = (extensionManifest.contributes?.languages ?? []).flatMap((language) => [
    ...(language.aliases ?? []),
    ...(language.extensions ?? []).map((extension) => `__ext_${extension.replace(/^\./, "")}`),
  ]);
  const tags = [...new Set([...(extensionManifest.keywords ?? []), "snippet", ...languageTags])].join(",");
  const property = (identifier, value) => `      <Property Id="${identifier}" Value="${escapeXml(value)}" />`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">',
    "  <Metadata>",
    `    <Identity Language="en-US" Id="${escapeXml(extensionManifest.name)}" Version="${escapeXml(extensionManifest.version)}" Publisher="${escapeXml(extensionManifest.publisher)}" />`,
    `    <DisplayName>${escapeXml(extensionManifest.displayName)}</DisplayName>`,
    `    <Description xml:space="preserve">${escapeXml(extensionManifest.description)}</Description>`,
    `    <Tags>${escapeXml(tags)}</Tags>`,
    `    <Categories>${escapeXml((extensionManifest.categories ?? []).join(","))}</Categories>`,
    "    <GalleryFlags>Public</GalleryFlags>",
    "    <Properties>",
    property("Microsoft.VisualStudio.Code.Engine", extensionManifest.engines.vscode),
    property("Microsoft.VisualStudio.Code.ExtensionDependencies", (extensionManifest.extensionDependencies ?? []).join(",")),
    property("Microsoft.VisualStudio.Code.ExtensionPack", ""),
    property("Microsoft.VisualStudio.Code.ExtensionKind", "workspace"),
    property("Microsoft.VisualStudio.Code.LocalizedLanguages", ""),
    property("Microsoft.VisualStudio.Code.ExecutesCode", "true"),
    property("Microsoft.VisualStudio.Services.Links.Source", repositoryUrl),
    property("Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown", "true"),
    property("Microsoft.VisualStudio.Services.Content.Pricing", "Free"),
    "    </Properties>",
    "    <License>extension/LICENSE.txt</License>",
    "  </Metadata>",
    '  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>',
    "  <Dependencies/>",
    "  <Assets>",
    '    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />',
    '    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md" Addressable="true" />',
    '    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />',
    "  </Assets>",
    "</PackageManifest>",
    "",
  ].join("\n");
}

function createContentTypes(archivePaths) {
  const contentTypes = new Map([[".vsixmanifest", "text/xml"]]);
  const knownTypes = { ".js": "application/javascript", ".cjs": "application/javascript", ".json": "application/json", ".md": "text/markdown", ".txt": "text/plain", ".ts": "text/plain" };
  for (const archivePath of archivePaths) {
    const extension = path.posix.extname(archivePath).toLowerCase();
    if (extension && !contentTypes.has(extension)) contentTypes.set(extension, knownTypes[extension] ?? "application/octet-stream");
  }
  const defaults = [...contentTypes].map(([extension, contentType]) => `<Default Extension="${escapeXml(extension)}" ContentType="${contentType}"/>`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join("")}</Types>\n`;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, tableIndex) => {
  let crcValue = tableIndex;
  for (let bitIndex = 0; bitIndex < 8; bitIndex++) crcValue = crcValue & 1 ? 0xedb88320 ^ (crcValue >>> 1) : crcValue >>> 1;
  return crcValue >>> 0;
});

function computeCrc32(buffer) {
  let crcValue = 0xffffffff;
  for (const byte of buffer) crcValue = CRC32_TABLE[(crcValue ^ byte) & 0xff] ^ (crcValue >>> 8);
  return (crcValue ^ 0xffffffff) >>> 0;
}

/** Writes a standard zip archive (deflate, UTF-8 names). */
function writeZip(outputPath, files) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const { archivePath, content } of files) {
    const nameBuffer = Buffer.from(archivePath, "utf8");
    const compressedContent = zlib.deflateRawSync(content, { level: 9 });
    const checksum = computeCrc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressedContent.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressedContent.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    localParts.push(localHeader, nameBuffer, compressedContent);
    centralParts.push(centralHeader, nameBuffer);
    localOffset += localHeader.length + nameBuffer.length + compressedContent.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  fs.writeFileSync(outputPath, Buffer.concat([...localParts, centralDirectory, endRecord]));
}

// 1. The extension itself
addFile("extension/package.json", path.join(extensionDirectory, "package.json"));
addFile("extension/readme.md", path.join(extensionDirectory, "README.md"));
addFile("extension/LICENSE.txt", path.join(extensionDirectory, "LICENSE"));
addFile("extension/INSTALL.md", path.join(extensionDirectory, "INSTALL.md"));
addFile("extension/language-configuration.json", path.join(extensionDirectory, "language-configuration.json"));
addDirectory("extension/syntaxes", path.join(extensionDirectory, "syntaxes"));
addDirectory("extension/snippets", path.join(extensionDirectory, "snippets"));
addDirectory("extension/dist", path.join(extensionDirectory, "dist"), (relativePath) => relativePath.endsWith(".js"));

// 2. The TypeScript server plugin, where the TypeScript server looks for plugins
addDirectory(`extension/node_modules/${TYPESCRIPT_PLUGIN_NAME}`, path.join(extensionDirectory, "typescript-plugin"));

// 3. The runtime dependency tree of the extension
const bundledPackages = addRuntimeDependencies();

if (archiveEntries.size > 0xffff) throw new Error("Too many files for a standard zip archive.");
const sortedArchivePaths = [...archiveEntries.keys()].sort();
const archiveFiles = [
  { archivePath: "[Content_Types].xml", content: Buffer.from(createContentTypes(sortedArchivePaths), "utf8") },
  { archivePath: "extension.vsixmanifest", content: Buffer.from(createVsixManifest(), "utf8") },
  ...sortedArchivePaths.map((archivePath) => ({ archivePath, content: fs.readFileSync(archiveEntries.get(archivePath)) })),
];
const outputPath = path.join(extensionDirectory, `${extensionManifest.name}-${extensionManifest.version}.vsix`);
writeZip(outputPath, archiveFiles);

const outputSizeMegabytes = (fs.statSync(outputPath).size / 1048576).toFixed(1);
console.log(`Packaged ${path.basename(outputPath)}: ${archiveFiles.length} files, ${outputSizeMegabytes} MB`);
console.log(`Bundled packages: ${TYPESCRIPT_PLUGIN_NAME}, ${bundledPackages.join(", ")}`);
