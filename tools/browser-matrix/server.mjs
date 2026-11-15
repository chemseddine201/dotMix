/* global URL */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPE_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

export function startMatrixServer(workspaceDirectory, scenarioDirectoryPath) {
  const currentBrowserResults = [];
  let completionNotifier = null;
  // Results are accepted only from the page opened for the current browser run.
  let activeRunToken = '';

  const serverInstance = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const pathname = requestUrl.pathname;

    if (request.method === 'POST' && pathname === '/results') {
      let bodyData = '';
      request.on('data', (dataChunk) => {
        bodyData += dataChunk;
      });
      request.on('end', () => {
        try {
          const parsedResult = JSON.parse(bodyData);
          if (parsedResult.runToken === activeRunToken) {
            const scenarioResult = { ...parsedResult };
            delete scenarioResult.runToken;
            currentBrowserResults.push(scenarioResult);
          }
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ acknowledged: true }));
        } catch (parseError) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: String(parseError) }));
        }
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/done') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ acknowledged: true }));
      if (completionNotifier && requestUrl.searchParams.get('run') === activeRunToken) {
        completionNotifier();
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/scenarios-list') {
      const scenarioEntries = fs.readdirSync(scenarioDirectoryPath);
      const scenarioFiles = scenarioEntries.filter((fileName) => fileName.endsWith('.js'));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(scenarioFiles));
      return;
    }

    if (request.method === 'GET' && pathname === '/empty.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!DOCTYPE html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"@dotmix/sync":"/packages/sync/dist/index.js","@dotmix/runtime":"/packages/runtime/dist/index.js"}}</script></head><body></body></html>');
      return;
    }

    let diskFilePath = null;
    if (pathname === '/' || pathname === '/index.html') {
      diskFilePath = path.join(workspaceDirectory, 'tools', 'browser-matrix', 'runner.html');
    } else if (pathname === '/runner.js') {
      diskFilePath = path.join(workspaceDirectory, 'tools', 'browser-matrix', 'runner.js');
    } else if (pathname.startsWith('/packages/')) {
      const sanitizedRelativePath = path.normalize(pathname.replace(/^\/packages\//, ''));
      diskFilePath = path.join(workspaceDirectory, 'packages', sanitizedRelativePath);
      const packagesRootDirectory = path.join(workspaceDirectory, 'packages');
      if (!diskFilePath.startsWith(packagesRootDirectory)) {
        response.writeHead(403, { 'Content-Type': 'text/plain' });
        response.end('Forbidden path traversal');
        return;
      }
    } else if (pathname.startsWith('/scenarios/')) {
      const scenarioRelativePath = path.normalize(pathname.replace(/^\/scenarios\//, ''));
      diskFilePath = path.join(scenarioDirectoryPath, scenarioRelativePath);
      if (!diskFilePath.startsWith(scenarioDirectoryPath)) {
        response.writeHead(403, { 'Content-Type': 'text/plain' });
        response.end('Forbidden path traversal');
        return;
      }
    }

    if (diskFilePath && fs.existsSync(diskFilePath) && fs.statSync(diskFilePath).isFile()) {
      const fileExtension = path.extname(diskFilePath);
      const contentType = MIME_TYPE_MAP[fileExtension] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(diskFilePath).pipe(response);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end(`Not found: ${pathname}`);
  });

  return new Promise((resolveServerStarted) => {
    serverInstance.listen(0, '127.0.0.1', () => {
      const assignedPort = serverInstance.address().port;
      resolveServerStarted({
        serverInstance,
        assignedPort,
        serverBaseUrl: `http://127.0.0.1:${assignedPort}`,
        waitForCompletion: () => {
          return new Promise((resolveComplete) => {
            completionNotifier = resolveComplete;
          });
        },
        resetResults: (runToken) => {
          currentBrowserResults.length = 0;
          completionNotifier = null;
          activeRunToken = runToken;
        },
        getResults: () => [...currentBrowserResults],
        stopServer: () => {
          return new Promise((resolveClosed) => {
            serverInstance.close(() => resolveClosed());
          });
        }
      });
    });
  });
}
