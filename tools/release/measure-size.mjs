/* global process, console */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const currentFileDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRootDirectory = path.resolve(currentFileDirectory, '..', '..');
const packagesRootDirectory = path.join(workspaceRootDirectory, 'packages');
const budgetFilePath = path.join(currentFileDirectory, 'size-budgets.json');

function listDistributionFiles(directoryPath) {
  const discoveredFilePaths = [];
  if (!fs.existsSync(directoryPath)) {
    return discoveredFilePaths;
  }
  const directoryEntries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entryItem of directoryEntries) {
    const entryAbsolutePath = path.join(directoryPath, entryItem.name);
    if (entryItem.isDirectory()) {
      discoveredFilePaths.push(...listDistributionFiles(entryAbsolutePath));
    } else if (entryItem.isFile()) {
      discoveredFilePaths.push(entryAbsolutePath);
    }
  }
  return discoveredFilePaths;
}

export function measureAllPackageSizes() {
  const packageFolderNames = fs
    .readdirSync(packagesRootDirectory)
    .filter((directoryName) => {
      const packagePath = path.join(packagesRootDirectory, directoryName);
      return fs.statSync(packagePath).isDirectory();
    })
    .sort();

  const measurementRecords = [];

  for (const folderName of packageFolderNames) {
    const packageDirectoryPath = path.join(packagesRootDirectory, folderName);
    const packageManifestPath = path.join(packageDirectoryPath, 'package.json');
    const distributionDirectoryPath = path.join(packageDirectoryPath, 'dist');

    if (!fs.existsSync(packageManifestPath) || !fs.existsSync(distributionDirectoryPath)) {
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

    const distributionFilePaths = listDistributionFiles(distributionDirectoryPath);

    let totalRawBytes = 0;
    let totalGzipBytes = 0;
    let javaScriptFileCount = 0;
    let javaScriptRawBytes = 0;
    let javaScriptGzipBytes = 0;

    for (const filePath of distributionFilePaths) {
      const fileBuffer = fs.readFileSync(filePath);
      const compressedBuffer = zlib.gzipSync(fileBuffer, { level: 9 });

      totalRawBytes += fileBuffer.length;
      totalGzipBytes += compressedBuffer.length;

      const isJavaScriptFile = filePath.endsWith('.js') || filePath.endsWith('.mjs');
      if (isJavaScriptFile) {
        javaScriptFileCount += 1;
        javaScriptRawBytes += fileBuffer.length;
        javaScriptGzipBytes += compressedBuffer.length;
      }
    }

    measurementRecords.push({
      directoryName: folderName,
      packageName,
      version: packageManifestContent.version,
      totalFileCount: distributionFilePaths.length,
      totalRawBytes,
      totalGzipBytes,
      totalGzipKilobytes: Number((totalGzipBytes / 1024).toFixed(2)),
      javaScriptFileCount,
      javaScriptRawBytes,
      javaScriptGzipBytes,
      javaScriptGzipKilobytes: Number((javaScriptGzipBytes / 1024).toFixed(2))
    });
  }

  return measurementRecords;
}

export function generateBudgetsPayload(measurementRecords) {
  const budgetsRecord = {};
  for (const record of measurementRecords) {
    budgetsRecord[record.packageName] = {
      directoryName: record.directoryName,
      version: record.version,
      measuredRawBytes: record.totalRawBytes,
      measuredGzipBytes: record.totalGzipBytes,
      measuredJavaScriptGzipBytes: record.javaScriptGzipBytes,
      budgetGzipBytes: record.totalGzipBytes,
      budgetJavaScriptGzipBytes: record.javaScriptGzipBytes
    };
  }
  return budgetsRecord;
}

export function checkSizesAgainstBudget(measurementRecords, budgetFilePathOverride) {
  const targetBudgetPath = budgetFilePathOverride || budgetFilePath;
  if (!fs.existsSync(targetBudgetPath)) {
    throw new Error(`Size budgets definition file not found at: ${targetBudgetPath}`);
  }

  const registeredBudgets = JSON.parse(fs.readFileSync(targetBudgetPath, 'utf8'));
  const budgetViolations = [];

  for (const currentRecord of measurementRecords) {
    const packageBudget = registeredBudgets[currentRecord.packageName];
    if (!packageBudget) {
      budgetViolations.push({
        packageName: currentRecord.packageName,
        reason: 'Unregistered package in size budgets'
      });
      continue;
    }

    const maximumAllowedGzipBytes = packageBudget.budgetGzipBytes;
    if (currentRecord.totalGzipBytes > maximumAllowedGzipBytes) {
      budgetViolations.push({
        packageName: currentRecord.packageName,
        measuredGzipBytes: currentRecord.totalGzipBytes,
        budgetGzipBytes: maximumAllowedGzipBytes,
        excessBytes: currentRecord.totalGzipBytes - maximumAllowedGzipBytes,
        reason: 'Exceeded total distribution gzip budget'
      });
    }
    const maximumAllowedJavaScriptGzipBytes = packageBudget.budgetJavaScriptGzipBytes;
    if (maximumAllowedJavaScriptGzipBytes !== undefined && currentRecord.javaScriptGzipBytes > maximumAllowedJavaScriptGzipBytes) {
      budgetViolations.push({
        packageName: currentRecord.packageName,
        measuredGzipBytes: currentRecord.javaScriptGzipBytes,
        budgetGzipBytes: maximumAllowedJavaScriptGzipBytes,
        excessBytes: currentRecord.javaScriptGzipBytes - maximumAllowedJavaScriptGzipBytes,
        reason: 'Exceeded JavaScript gzip budget'
      });
    }
  }

  return {
    passed: budgetViolations.length === 0,
    violations: budgetViolations
  };
}

function printMeasurementTable(measurementRecords) {
  console.log('\n=== Publishable Package Distribution Sizes (Gzip) ===\n');
  console.log(
    'Package'.padEnd(28) +
      'Files'.padStart(7) +
      'Raw (B)'.padStart(12) +
      'Gzip (B)'.padStart(12) +
      'Gzip (KB)'.padStart(12) +
      'JS Gzip (B)'.padStart(14)
  );
  console.log('-'.repeat(85));

  for (const record of measurementRecords) {
    console.log(
      record.packageName.padEnd(28) +
        String(record.totalFileCount).padStart(7) +
        String(record.totalRawBytes).padStart(12) +
        String(record.totalGzipBytes).padStart(12) +
        String(record.totalGzipKilobytes).padStart(12) +
        String(record.javaScriptGzipBytes).padStart(14)
    );
  }
  console.log('-'.repeat(85));
}

async function runCliEntrypoint() {
  const commandArguments = process.argv.slice(2);
  const isCheckMode = commandArguments.includes('--check');
  const isUpdateMode = commandArguments.includes('--update');

  const measurementRecords = measureAllPackageSizes();
  printMeasurementTable(measurementRecords);

  if (isCheckMode) {
    console.log(`\nVerifying sizes against ${budgetFilePath}...`);
    const checkOutcome = checkSizesAgainstBudget(measurementRecords);
    if (!checkOutcome.passed) {
      console.error('\nERROR: Package bundle size budget violation detected!');
      for (const violation of checkOutcome.violations) {
        console.error(
          ` - ${violation.packageName}: measured ${violation.measuredGzipBytes} B exceeds budget ${violation.budgetGzipBytes} B (+${violation.excessBytes} B)`
        );
      }
      process.exit(1);
    }
    console.log('SUCCESS: All packages are within registered size budgets.');
    return;
  }

  if (isUpdateMode || !fs.existsSync(budgetFilePath)) {
    const budgetsPayload = generateBudgetsPayload(measurementRecords);
    fs.writeFileSync(
      budgetFilePath,
      JSON.stringify(budgetsPayload, null, 2) + '\n',
      'utf8'
    );
    console.log(`\nRecorded measured size budgets into ${budgetFilePath}`);
  }
}

const isDirectExecution =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runCliEntrypoint().catch((executionError) => {
    console.error('Measurement execution failed:', executionError);
    process.exit(1);
  });
}
