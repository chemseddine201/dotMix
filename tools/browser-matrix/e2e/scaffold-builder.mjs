/* global process, console */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const LANGUAGE_CONFIGURATIONS = [
  { languageName: 'ts', cliFlag: '--ts', isTypeScript: true },
  { languageName: 'js', cliFlag: '--js', isTypeScript: false }
];

const STYLESHEET_FORMATS = ['scss', 'sass', 'less', 'pcss', 'css'];

function generateErrorTrackingScript(resetPathToRoot = true) {
  const lines = ['<script>'];
  if (resetPathToRoot) {
    lines.push('try { window.history.replaceState(null, "", "/"); } catch {}');
  }
  lines.push(
    'window.__e2e_errors = [];',
    'window.addEventListener("error", function(errorEvent) {',
    '  window.__e2e_errors.push("Uncaught error: " + (errorEvent.message || errorEvent.error));',
    '});',
    'window.addEventListener("unhandledrejection", function(rejectionEvent) {',
    '  window.__e2e_errors.push("Unhandled rejection: " + rejectionEvent.reason);',
    '});',
    'const standardConsoleError = console.error;',
    'console.error = function(...errorArguments) {',
    '  window.__e2e_errors.push("Console error: " + errorArguments.join(" "));',
    '  standardConsoleError.apply(console, errorArguments);',
    '};',
    '</script>'
  );
  return lines.join('\n');
}

export function prepareEndToEndArtifacts(workspaceDirectory) {
  const temporaryRootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mix-e2e-matrix-scaffolds-')
  );
  const cliBinaryPath = path.join(workspaceDirectory, 'packages', 'cli', 'dist', 'bin.js');
  const showcaseDirectory = path.join(workspaceDirectory, 'examples', 'showcase');

  // Test the real production output: the hashed bundle, its index.html, import map and public/ files.
  console.log('Building showcase with the CLI (production build)...');
  const showcaseE2eDirectory = path.join(temporaryRootDirectory, 'showcase');
  const showcaseSourcesResult = spawnSync(process.execPath, ['scripts/copy-demo-sources.mjs'], {
    encoding: 'utf8',
    cwd: showcaseDirectory
  });
  const showcaseBuildResult = showcaseSourcesResult.status === 0
    ? spawnSync(process.execPath, [cliBinaryPath, 'build', 'src', showcaseE2eDirectory, '--clean', '--base', '/scaffolds/showcase/'], {
        encoding: 'utf8',
        cwd: showcaseDirectory
      })
    : showcaseSourcesResult;
  if (showcaseBuildResult.status !== 0) {
    throw new Error(`Failed to build showcase: ${showcaseBuildResult.stderr || showcaseBuildResult.stdout}`);
  }
  const showcaseIndexPath = path.join(showcaseE2eDirectory, 'index.html');
  const showcaseIndexHtml = fs.readFileSync(showcaseIndexPath, 'utf8');
  const errorTrackingHead = `<head>\n${generateErrorTrackingScript(false)}`;
  fs.writeFileSync(showcaseIndexPath, showcaseIndexHtml.replace('<head>', errorTrackingHead), 'utf8');

  const scaffoldRegistry = { showcase: showcaseE2eDirectory };
  const scenarioDefinitions = [
    {
      identifier: 'showcase',
      title: 'Showcase Application',
      pageUrl: '/scaffolds/showcase/index.html',
      applicationType: 'showcase'
    }
  ];

  console.log('Scaffolding and building golden-path variants...');
  for (const languageConfig of LANGUAGE_CONFIGURATIONS) {
    for (const styleFormat of STYLESHEET_FORMATS) {
      const variantIdentifier = `${languageConfig.languageName}-${styleFormat}`;
      const projectTargetDirectory = path.join(temporaryRootDirectory, `app-${variantIdentifier}`);
      const distributionDirectory = path.join(projectTargetDirectory, 'dist');
      const sourceDirectory = path.join(projectTargetDirectory, 'src');

      console.log(` - Building variant: ${variantIdentifier}...`);

      const scaffoldResult = spawnSync(
        process.execPath,
        [
          cliBinaryPath,
          'create',
          `app-${variantIdentifier}`,
          languageConfig.cliFlag,
          `--${styleFormat}`,
          '--target',
          projectTargetDirectory
        ],
        { encoding: 'utf8' }
      );

      if (scaffoldResult.status !== 0) {
        throw new Error(
          `Failed to scaffold ${variantIdentifier}: ${scaffoldResult.stderr || scaffoldResult.stdout}`
        );
      }

      // Production build, like the showcase: hashed modules, import map and index.html under the
      // variant's base path. The error-tracking script is injected first in <head>.
      const buildResult = spawnSync(
        process.execPath,
        [
          cliBinaryPath,
          'build',
          sourceDirectory,
          distributionDirectory,
          '--clean',
          '--base',
          `/scaffolds/${variantIdentifier}/`
        ],
        { encoding: 'utf8', cwd: projectTargetDirectory }
      );

      if (buildResult.status !== 0) {
        throw new Error(
          `Failed to build ${variantIdentifier}: ${buildResult.stderr || buildResult.stdout}`
        );
      }

      const scaffoldIndexPath = path.join(distributionDirectory, 'index.html');
      const scaffoldIndexHtml = fs.readFileSync(scaffoldIndexPath, 'utf8');
      if (!scaffoldIndexHtml.includes('<head>')) {
        throw new Error(`The production index.html of ${variantIdentifier} has no <head> element.`);
      }
      fs.writeFileSync(
        scaffoldIndexPath,
        scaffoldIndexHtml.replace('<head>', `<head>\n${generateErrorTrackingScript()}`),
        'utf8'
      );

      scaffoldRegistry[variantIdentifier] = distributionDirectory;
      scenarioDefinitions.push({
        identifier: `scaffold-${variantIdentifier}`,
        title: `Golden Path Scaffold [${variantIdentifier}]`,
        pageUrl: `/scaffolds/${variantIdentifier}/index.html`,
        applicationType: 'scaffold'
      });
    }
  }

  return {
    temporaryRootDirectory,
    scaffoldRegistry,
    scenarioDefinitions,
    cleanupArtifacts: () => {
      try {
        if (fs.existsSync(temporaryRootDirectory)) {
          fs.rmSync(temporaryRootDirectory, { recursive: true, force: true });
        }
      } catch {
        // Silently tolerate deferred directory removal on Windows
      }
    }
  };
}
