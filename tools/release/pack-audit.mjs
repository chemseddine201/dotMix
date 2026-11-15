/* global process, console */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const currentFileDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRootDirectory = path.resolve(currentFileDirectory, '..', '..');
const packagesRootDirectory = path.join(workspaceRootDirectory, 'packages');
const evidenceDirectoryPath = path.join(
  workspaceRootDirectory,
  'reports',
  'final-pass-evidence'
);

function resolveRelativeTarget(baseDirectory, relativeTargetSpecifier) {
  if (!relativeTargetSpecifier) return false;
  const normalizedTarget = path.resolve(baseDirectory, relativeTargetSpecifier);
  return fs.existsSync(normalizedTarget);
}

export function auditPackageRegistryReadiness() {
  if (!fs.existsSync(evidenceDirectoryPath)) {
    fs.mkdirSync(evidenceDirectoryPath, { recursive: true });
  }

  const packageFolderNames = fs
    .readdirSync(packagesRootDirectory)
    .filter((directoryName) => {
      const packagePath = path.join(packagesRootDirectory, directoryName);
      return fs.statSync(packagePath).isDirectory();
    })
    .sort();

  const auditResults = [];

  for (const folderName of packageFolderNames) {
    const packageDirectoryPath = path.join(packagesRootDirectory, folderName);
    const packageManifestPath = path.join(packageDirectoryPath, 'package.json');

    if (!fs.existsSync(packageManifestPath)) {
      continue;
    }

    const packageManifestContent = JSON.parse(
      fs.readFileSync(packageManifestPath, 'utf8')
    );
    const packageName = packageManifestContent.name;
    const isPrivatePackage = Boolean(packageManifestContent.private);

    if (isPrivatePackage) {
      continue;
    }

    console.log(`Auditing and packing ${packageName} (${folderName})...`);

    // Execute dry-run pack for workspace package
    const npmPackExecution = spawnSync(
      'npm',
      ['pack', `--workspace=${packageName}`, '--dry-run', '--json'],
      {
        cwd: workspaceRootDirectory,
        encoding: 'utf8',
        shell: true
      }
    );

    let parsedPackData = null;
    let packRawOutput = npmPackExecution.stdout;

    try {
      // Find JSON block in stdout if warnings precede it
      const jsonStartMarker = packRawOutput.indexOf('[');
      if (jsonStartMarker !== -1) {
        parsedPackData = JSON.parse(packRawOutput.slice(jsonStartMarker));
      } else {
        parsedPackData = JSON.parse(packRawOutput);
      }
    } catch (parseError) {
      console.error(`Failed to parse npm pack output for ${packageName}:`, parseError);
    }

    // Save pack json evidence
    const packEvidenceFilePath = path.join(
      evidenceDirectoryPath,
      `pack-${folderName}.json`
    );
    fs.writeFileSync(
      packEvidenceFilePath,
      JSON.stringify(parsedPackData || { error: npmPackExecution.stderr }, null, 2),
      'utf8'
    );

    // 1. Shipped files audit
    const packedFilesList = parsedPackData?.[0]?.files || [];
    const packedPathList = packedFilesList.map((fileEntry) => fileEntry.path);

    const unexpectedShippedFiles = packedPathList.filter((shippedPath) => {
      if (shippedPath === 'package.json') return false;
      if (shippedPath === 'README.md' || shippedPath === 'README.ar.md') return false;
      if (shippedPath === 'LICENSE' || shippedPath === 'LICENSE.ar.md') return false;
      if (shippedPath.startsWith('dist/')) return false;
      return true;
    });

    const isDistShipped = packedPathList.some((shippedPath) =>
      shippedPath.startsWith('dist/')
    );

    // 2. Exports and types resolution audit
    const exportDiagnostics = [];
    if (packageManifestContent.main) {
      const isMainResolved = resolveRelativeTarget(
        packageDirectoryPath,
        packageManifestContent.main
      );
      if (!isMainResolved) {
        exportDiagnostics.push(`Main entrypoint missing: ${packageManifestContent.main}`);
      }
    }

    if (packageManifestContent.types) {
      const isTypesResolved = resolveRelativeTarget(
        packageDirectoryPath,
        packageManifestContent.types
      );
      if (!isTypesResolved) {
        exportDiagnostics.push(`Types entrypoint missing: ${packageManifestContent.types}`);
      }
    }

    if (packageManifestContent.exports) {
      for (const [exportKey, exportTarget] of Object.entries(
        packageManifestContent.exports
      )) {
        if (typeof exportTarget === 'string') {
          const isResolved = resolveRelativeTarget(
            packageDirectoryPath,
            exportTarget
          );
          if (!isResolved) {
            exportDiagnostics.push(`Export ${exportKey} missing target: ${exportTarget}`);
          }
        } else if (typeof exportTarget === 'object' && exportTarget !== null) {
          if (exportTarget.types) {
            const isTypesResolved = resolveRelativeTarget(
              packageDirectoryPath,
              exportTarget.types
            );
            if (!isTypesResolved) {
              exportDiagnostics.push(
                `Export ${exportKey} missing types target: ${exportTarget.types}`
              );
            }
          }
          if (exportTarget.default) {
            const isDefaultResolved = resolveRelativeTarget(
              packageDirectoryPath,
              exportTarget.default
            );
            if (!isDefaultResolved) {
              exportDiagnostics.push(
                `Export ${exportKey} missing default target: ${exportTarget.default}`
              );
            }
          }
        }
      }
    }

    // 3. Runtime dependencies audit
    const declaredDependencies = packageManifestContent.dependencies || {};
    const externalRuntimeDependencies = [];

    for (const dependencyName of Object.keys(declaredDependencies)) {
      const isWorkspacePackage =
        dependencyName.startsWith('@dotmix/') || dependencyName === '@dotmix/helpers';
      if (!isWorkspacePackage) {
        externalRuntimeDependencies.push(dependencyName);
      }
    }

    // 4. Version consistency audit
    const declaredVersion = packageManifestContent.version;
    const isStandardVersion = declaredVersion === '0.1.0';

    auditResults.push({
      directoryName: folderName,
      packageName,
      version: declaredVersion,
      isStandardVersion,
      packedEntryCount: packedFilesList.length,
      isDistShipped,
      unexpectedShippedFilesCount: unexpectedShippedFiles.length,
      unexpectedShippedFiles,
      exportsValid: exportDiagnostics.length === 0,
      exportDiagnostics,
      externalRuntimeDependenciesCount: externalRuntimeDependencies.length,
      externalRuntimeDependencies
    });
  }

  return auditResults;
}

function printAuditReport(auditResults) {
  console.log('\n=== Package Distribution & Pack Verification Report ===\n');
  console.log(
    'Package'.padEnd(28) +
      'Version'.padEnd(10) +
      'Exports'.padEnd(10) +
      'Ext Deps'.padEnd(10) +
      'Files'.padEnd(10) +
      'Clean Ship'
  );
  console.log('-'.repeat(78));

  for (const item of auditResults) {
    const exportsStatus = item.exportsValid ? 'OK' : 'FAIL';
    const dependenciesStatus =
      item.externalRuntimeDependenciesCount === 0 ? '0 (OK)' : `${item.externalRuntimeDependenciesCount} (FAIL)`;
    const cleanShipStatus =
      item.isDistShipped && item.unexpectedShippedFilesCount === 0 ? 'PASS' : 'FLAGGED';

    console.log(
      item.packageName.padEnd(28) +
        item.version.padEnd(10) +
        exportsStatus.padEnd(10) +
        dependenciesStatus.padEnd(10) +
        String(item.packedEntryCount).padEnd(10) +
        cleanShipStatus
    );
  }
  console.log('-'.repeat(78));
}

const isDirectExecution =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const auditResults = auditPackageRegistryReadiness();
  printAuditReport(auditResults);
}
