#!/usr/bin/env node
/**
 * @dotmix/language-server — Standalone Stdio LSP Server Daemon
 *
 * Implements standard JSON-RPC 2.0 Language Server Protocol over stdin/stdout.
 * Compatible with VS Code Language Client, Neovim (nvim-lspconfig), Helix, Sublime Text, Emacs, and Zed.
 */

import process from "node:process";
import { Buffer } from "node:buffer";
import console from "node:console";
import { MixLanguageService, DiagnosticSeverity } from "../dist/index.js";

export function createLspServer(input = process.stdin, output = process.stdout) {
  const service = new MixLanguageService();
  const openDocuments = new Map(); // uri -> string
  let buffer = Buffer.alloc(0);

  function send(msg) {
    const json = JSON.stringify(msg);
    const byteLen = Buffer.byteLength(json, "utf-8");
    const header = `Content-Length: ${byteLen}\r\n\r\n`;
    output.write(header + json);
  }

  function sendResponse(id, result, error = null) {
    const resp = { jsonrpc: "2.0", id };
    if (error) {
      resp.error = error;
    } else {
      resp.result = result;
    }
    send(resp);
  }

  function sendNotification(method, params) {
    send({ jsonrpc: "2.0", method, params });
  }

  function publishDiagnostics(uri, text) {
    const diags = service.getDiagnostics(uri, text);
    const lspDiags = diags.map((d) => ({
      range: d.range,
      message: d.message,
      severity: d.severity || DiagnosticSeverity.Error,
      code: d.code,
      source: "dotMix",
    }));

    sendNotification("textDocument/publishDiagnostics", {
      uri,
      diagnostics: lspDiags,
    });
  }

  function handleMessage(msg) {
    const { id, method, params } = msg;

    switch (method) {
      case "initialize": {
        sendResponse(id, {
          capabilities: {
            textDocumentSync: 1, // Full document sync
            hoverProvider: true,
            completionProvider: {
              triggerCharacters: [".", "<", "{", ":", "\"", "'", "/", " "],
            },
            definitionProvider: true,
          },
          serverInfo: {
            name: "dotmix-language-server",
            version: "0.1.1",
          },
        });
        break;
      }

      case "initialized": {
        // Client ack
        break;
      }

      case "textDocument/didOpen": {
        if (params?.textDocument) {
          const { uri, text } = params.textDocument;
          openDocuments.set(uri, text);
          service.setWorkspaceFile(uri, text);
          publishDiagnostics(uri, text);
        }
        break;
      }

      case "textDocument/didChange": {
        if (params?.textDocument && params.contentChanges?.length > 0) {
          const uri = params.textDocument.uri;
          const text = params.contentChanges[0].text;
          openDocuments.set(uri, text);
          service.setWorkspaceFile(uri, text);
          publishDiagnostics(uri, text);
        }
        break;
      }

      case "textDocument/didClose": {
        if (params?.textDocument) {
          openDocuments.delete(params.textDocument.uri);
        }
        break;
      }

      case "textDocument/hover": {
        if (params?.textDocument && params.position) {
          const uri = params.textDocument.uri;
          const text = openDocuments.get(uri) || service.getFileContent(uri) || "";
          const hover = service.doHover(uri, text, params.position);
          if (hover) {
            sendResponse(id, {
              contents: hover.contents,
              range: hover.range,
            });
          } else {
            sendResponse(id, null);
          }
        } else {
          sendResponse(id, null);
        }
        break;
      }

      case "textDocument/completion": {
        if (params?.textDocument && params.position) {
          const uri = params.textDocument.uri;
          const text = openDocuments.get(uri) || service.getFileContent(uri) || "";
          const items = service.doComplete(uri, text, params.position);
          sendResponse(id, {
            isIncomplete: false,
            items: items.map((i) => ({
              label: i.label,
              kind: i.kind,
              detail: i.detail,
              documentation: i.documentation,
              insertText: i.insertText,
            })),
          });
        } else {
          sendResponse(id, { isIncomplete: false, items: [] });
        }
        break;
      }

      case "textDocument/definition": {
        if (params?.textDocument && params.position) {
          const uri = params.textDocument.uri;
          const text = openDocuments.get(uri) || service.getFileContent(uri) || "";
          const def = service.doDefinition(uri, text, params.position);
          if (def) {
            sendResponse(id, {
              uri: def.uri,
              range: def.range,
            });
          } else {
            sendResponse(id, null);
          }
        } else {
          sendResponse(id, null);
        }
        break;
      }

      case "shutdown": {
        sendResponse(id, null);
        break;
      }

      case "exit": {
        break;
      }

      default: {
        if (id !== undefined) {
          sendResponse(id, null, {
            code: -32601,
            message: `Method '${method}' not found`,
          });
        }
        break;
      }
    }
  }

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const headerText = buffer.slice(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!match || !match[1]) {
        // Invalid header; skip
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const totalMsgLength = headerEnd + 4 + contentLength;
      if (buffer.length < totalMsgLength) {
        // Incomplete message; wait for more chunks
        break;
      }

      const bodyBuffer = buffer.slice(headerEnd + 4, totalMsgLength);
      buffer = buffer.slice(totalMsgLength);

      try {
        const msg = JSON.parse(bodyBuffer.toString("utf-8"));
        handleMessage(msg);
      } catch (err) {
        console.error("LSP JSON-RPC parse error:", err);
      }
    }
  }

  input.on("data", onData);

  return {
    service,
    close: () => {
      input.removeListener("data", onData);
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("dotmix-lsp.js")) {
  createLspServer(process.stdin, process.stdout);
}
