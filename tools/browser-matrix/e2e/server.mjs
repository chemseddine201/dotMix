/* global URL */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_TYPE_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function resolveExistingFile(candidatePath) {
  if (!candidatePath) return null;
  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
    return candidatePath;
  }
  if (fs.existsSync(candidatePath + '.js') && fs.statSync(candidatePath + '.js').isFile()) {
    return candidatePath + '.js';
  }
  if (fs.existsSync(candidatePath + '.mjs') && fs.statSync(candidatePath + '.mjs').isFile()) {
    return candidatePath + '.mjs';
  }
  const indexJsCandidate = path.join(candidatePath, 'index.js');
  if (fs.existsSync(indexJsCandidate) && fs.statSync(indexJsCandidate).isFile()) {
    return indexJsCandidate;
  }
  const indexMjsCandidate = path.join(candidatePath, 'index.mjs');
  if (fs.existsSync(indexMjsCandidate) && fs.statSync(indexMjsCandidate).isFile()) {
    return indexMjsCandidate;
  }
  return null;
}

function buildComprehensiveImportMap() {
  return {
    imports: {
      '@dotmix/runtime': '/packages/runtime/dist/index.js',
      '@dotmix/runtime/': '/packages/runtime/dist/',
      '@dotmix/runtime/permissions': '/packages/runtime/dist/permissions/index.js',
      '@dotmix/router': '/packages/router/dist/index.js',
      '@dotmix/router/': '/packages/router/dist/',
      '@dotmix/sync': '/packages/sync/dist/index.js',
      '@dotmix/sync/': '/packages/sync/dist/',
      '@dotmix/sanitizer-dompurify': '/packages/sanitizer-dompurify/dist/index.js',
      '@dotmix/helpers': '/packages/helpers/dist/index.js',
      '@dotmix/helpers/': '/packages/helpers/dist/',
      '@dotmix/helpers/http': '/packages/helpers/dist/http/index.js',
      '@dotmix/helpers/datetime': '/packages/helpers/dist/datetime/index.js',
      '@dotmix/helpers/data': '/packages/helpers/dist/data/index.js',
      '@dotmix/helpers/async': '/packages/helpers/dist/async/index.js',
      '@dotmix/helpers/web': '/packages/helpers/dist/web/index.js'
    }
  };
}

export function startEndToEndServer(workspaceDirectory, scaffoldRegistry, scenarioList) {
  const recordedBrowserResults = [];
  let completionNotificationCallback = null;
  let currentActiveRunToken = '';

  const serverInstance = http.createServer((incomingRequest, serverResponse) => {
    const parsedRequestUrl = new URL(
      incomingRequest.url,
      `http://${incomingRequest.headers.host}`
    );
    const requestPath = parsedRequestUrl.pathname;

    if (incomingRequest.method === 'POST' && requestPath === '/results') {
      let payloadBuffer = '';
      incomingRequest.on('data', (dataChunk) => {
        payloadBuffer += dataChunk;
      });
      incomingRequest.on('end', () => {
        try {
          const parsedPayload = JSON.parse(payloadBuffer);
          if (parsedPayload.runToken === currentActiveRunToken) {
            const sanitizedResult = { ...parsedPayload };
            delete sanitizedResult.runToken;
            recordedBrowserResults.push(sanitizedResult);
          }
          serverResponse.writeHead(200, { 'Content-Type': 'application/json' });
          serverResponse.end(JSON.stringify({ acknowledged: true }));
        } catch (parseError) {
          serverResponse.writeHead(400, { 'Content-Type': 'application/json' });
          serverResponse.end(JSON.stringify({ error: String(parseError) }));
        }
      });
      return;
    }

    if (incomingRequest.method === 'POST' && requestPath === '/done') {
      serverResponse.writeHead(200, { 'Content-Type': 'application/json' });
      serverResponse.end(JSON.stringify({ acknowledged: true }));
      const runParameter = parsedRequestUrl.searchParams.get('run');
      if (completionNotificationCallback && runParameter === currentActiveRunToken) {
        completionNotificationCallback();
      }
      return;
    }

    if (incomingRequest.method === 'GET' && requestPath === '/e2e-scenarios-list') {
      serverResponse.writeHead(200, { 'Content-Type': 'application/json' });
      serverResponse.end(JSON.stringify(scenarioList));
      return;
    }

    let resolvedDiskPath = null;

    if (requestPath === '/' || requestPath === '/index.html') {
      resolvedDiskPath = path.join(
        workspaceDirectory,
        'tools',
        'browser-matrix',
        'e2e',
        'runner.html'
      );
    } else if (requestPath === '/runner.js') {
      resolvedDiskPath = path.join(
        workspaceDirectory,
        'tools',
        'browser-matrix',
        'e2e',
        'runner.js'
      );
    } else if (requestPath.startsWith('/showcase/')) {
      const showcaseRelativePath = path.normalize(requestPath.replace(/^\/showcase\//, ''));
      if (showcaseRelativePath === '' || showcaseRelativePath === 'index.html') {
        const showcaseIndexPath = path.join(workspaceDirectory, 'examples', 'showcase', 'index.html');
        if (fs.existsSync(showcaseIndexPath)) {
          let htmlContent = fs.readFileSync(showcaseIndexPath, 'utf8');
          htmlContent = htmlContent
            .replaceAll('/runtime/index.js', '/packages/runtime/dist/index.js')
            .replaceAll('/sanitizer-dompurify/index.js', '/packages/sanitizer-dompurify/dist/index.js');

          const telemetryHeader = [
            '<script>',
            'window.__e2e_errors = [];',
            'window.addEventListener("error", function(e) { window.__e2e_errors.push("Uncaught error: " + (e.message || e.error)); });',
            'window.addEventListener("unhandledrejection", function(e) { window.__e2e_errors.push("Unhandled rejection: " + e.reason); });',
            'const origErr = console.error;',
            'console.error = function(...args) { window.__e2e_errors.push("Console error: " + args.join(" ")); origErr.apply(console, args); };',
            '</script>',
            '<script type="importmap">',
            JSON.stringify(buildComprehensiveImportMap(), null, 2),
            '</script>'
          ].join('\n');
          htmlContent = htmlContent.replace('<head>', `<head>\n${telemetryHeader}`);
          serverResponse.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
          });
          serverResponse.end(htmlContent);
          return;
        }
      } else {
        const directCandidate = path.join(workspaceDirectory, 'examples', 'showcase', showcaseRelativePath);
        resolvedDiskPath = resolveExistingFile(directCandidate);
      }
    } else if (requestPath.startsWith('/dist/')) {
      const distRelativePath = path.normalize(requestPath.replace(/^\/dist\//, ''));
      const directCandidate = path.join(
        workspaceDirectory,
        'examples',
        'showcase',
        'dist-web',
        distRelativePath
      );
      resolvedDiskPath = resolveExistingFile(directCandidate);
    } else if (requestPath.startsWith('/runtime/')) {
      const targetSubpath = requestPath.replace(/^\/runtime\//, '');
      serverResponse.writeHead(301, { Location: `/packages/runtime/dist/${targetSubpath}` });
      serverResponse.end();
      return;
    } else if (requestPath.startsWith('/router/')) {
      const targetSubpath = requestPath.replace(/^\/router\//, '');
      serverResponse.writeHead(301, { Location: `/packages/router/dist/${targetSubpath}` });
      serverResponse.end();
      return;
    } else if (requestPath.startsWith('/sync/')) {
      const targetSubpath = requestPath.replace(/^\/sync\//, '');
      serverResponse.writeHead(301, { Location: `/packages/sync/dist/${targetSubpath}` });
      serverResponse.end();
      return;
    } else if (requestPath.startsWith('/sanitizer-dompurify/')) {
      const targetSubpath = requestPath.replace(/^\/sanitizer-dompurify\//, '');
      serverResponse.writeHead(301, { Location: `/packages/sanitizer-dompurify/dist/${targetSubpath}` });
      serverResponse.end();
      return;
    } else if (requestPath.startsWith('/helpers/')) {
      const targetSubpath = requestPath.replace(/^\/helpers\//, '');
      serverResponse.writeHead(301, { Location: `/packages/helpers/dist/${targetSubpath}` });
      serverResponse.end();
      return;
    } else if (requestPath.startsWith('/packages/')) {
      const packageRelativePath = path.normalize(requestPath.replace(/^\/packages\//, ''));
      const directCandidate = path.join(workspaceDirectory, 'packages', packageRelativePath);
      resolvedDiskPath = resolveExistingFile(directCandidate);
    } else if (requestPath.startsWith('/scaffolds/')) {
      const scaffoldPathSegments = requestPath.replace(/^\/scaffolds\//, '').split('/');
      const variantIdentifier = scaffoldPathSegments[0];
      const interiorPath = scaffoldPathSegments.slice(1).join('/');

      const targetScaffoldDirectory = scaffoldRegistry[variantIdentifier];
      if (targetScaffoldDirectory) {
        if (!interiorPath || interiorPath === 'index.html') {
          resolvedDiskPath = path.join(targetScaffoldDirectory, 'index.html');
        } else {
          const directCandidate = path.join(targetScaffoldDirectory, interiorPath);
          resolvedDiskPath = resolveExistingFile(directCandidate);
        }
      }
    }

    if (resolvedDiskPath && fs.existsSync(resolvedDiskPath) && fs.statSync(resolvedDiskPath).isFile()) {
      const fileExtension = path.extname(resolvedDiskPath);
      const isCssFile = fileExtension === '.css';
      const isScriptDestination = incomingRequest.headers['sec-fetch-dest'] !== 'style';

      // Serve CSS imported by JavaScript as a valid ES module that injects style
      if (isCssFile && isScriptDestination) {
        const rawCss = fs.readFileSync(resolvedDiskPath, 'utf8');
        const serializedCss = JSON.stringify(rawCss);
        const cssModuleSource = [
          `const cssText = ${serializedCss};`,
          'if (typeof document !== "undefined") {',
          '  const styleElement = document.createElement("style");',
          '  styleElement.textContent = cssText;',
          '  document.head.appendChild(styleElement);',
          '}',
          'export default cssText;'
        ].join('\n');

        serverResponse.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        serverResponse.end(cssModuleSource);
        return;
      }

      const mimeType = CONTENT_TYPE_MAP[fileExtension] || 'application/octet-stream';
      serverResponse.writeHead(200, {
        'Content-Type': mimeType,
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(resolvedDiskPath).pipe(serverResponse);
      return;
    }

    serverResponse.writeHead(404, { 'Content-Type': 'text/plain' });
    serverResponse.end(`Not found: ${requestPath}`);
  });

  return new Promise((resolveServerReady) => {
    serverInstance.listen(0, '127.0.0.1', () => {
      const allocatedPort = serverInstance.address().port;
      resolveServerReady({
        serverInstance,
        allocatedPort,
        serverBaseUrl: `http://127.0.0.1:${allocatedPort}`,
        waitForCompletion: () => {
          return new Promise((resolveCompletion) => {
            completionNotificationCallback = resolveCompletion;
          });
        },
        resetResults: (runToken) => {
          recordedBrowserResults.length = 0;
          completionNotificationCallback = null;
          currentActiveRunToken = runToken;
        },
        getResults: () => [...recordedBrowserResults],
        stopServer: () => {
          return new Promise((resolveClosed) => {
            serverInstance.close(() => resolveClosed());
          });
        }
      });
    });
  });
}
