import { describe, it } from "node:test";
import assert from "node:assert/strict";
import httpNode from "node:http";
import { http, createHttpClient, isHttpError, useHttp } from "mix-helpers/http";
import { createCancellationTokenSource } from "@mix/runtime";

describe("mix-helpers/http: HTTP client, interceptors, retry, dedupe, cache & useHttp hook", () => {
  it("1. Standard CRUD requests, interceptors, and typed response envelope", async () => {
    let receivedHeader = "";
    const server = httpNode.createServer((req, res) => {
      receivedHeader = req.headers["x-custom-auth"] || "";
      if (req.method === "GET" && req.url === "/api/users") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: 1, name: "Alice" }]));
      } else if (req.method === "POST" && req.url === "/api/users") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const parsed = JSON.parse(body);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: 2, ...parsed }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const baseURL = `http://127.0.0.1:${port}`;

    try {
      const client = createHttpClient({ baseURL });

      // Request interceptor
      client.interceptors.request.use((config) => {
        config.headers = config.headers || {};
        config.headers["x-custom-auth"] = "Bearer secret-token-123";
        return config;
      });

      // GET
      const getRes = await client.get("/api/users");
      assert.strictEqual(getRes.status, 200);
      assert.deepStrictEqual(getRes.data, [{ id: 1, name: "Alice" }]);
      assert.strictEqual(receivedHeader, "Bearer secret-token-123");

      // POST
      const postRes = await client.post("/api/users", { name: "Bob" });
      assert.strictEqual(postRes.status, 201);
      assert.strictEqual(postRes.data.id, 2);
      assert.strictEqual(postRes.data.name, "Bob");
    } finally {
      server.close();
    }
  });

  it("2. Automatic retry on transient server errors (500/503)", async () => {
    let attempts = 0;
    const server = httpNode.createServer((req, res) => {
      attempts++;
      if (attempts < 3) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Service Unavailable");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, attempts }));
      }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    try {
      const client = createHttpClient({
        baseURL: `http://127.0.0.1:${port}`,
        retry: { retries: 3, delayMs: 10 }
      });

      const res = await client.get("/api/flaky");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.ok, true);
      assert.strictEqual(res.data.attempts, 3);
    } finally {
      server.close();
    }
  });

  it("3. In-flight request deduplication and TTL caching", async () => {
    let requestCount = 0;
    const server = httpNode.createServer((req, res) => {
      requestCount++;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ count: requestCount }));
      }, 30);
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    try {
      const client = createHttpClient({
        baseURL: `http://127.0.0.1:${port}`,
        dedupe: true,
        cache: { ttlMs: 1000 }
      });

      // 2 concurrent requests deduplicated into 1 network call
      const [r1, r2] = await Promise.all([
        client.get("/api/data"),
        client.get("/api/data")
      ]);
      assert.strictEqual(requestCount, 1);
      assert.strictEqual(r1.data.count, 1);
      assert.strictEqual(r2.data.count, 1);

      // Subsequent call served from cache
      const r3 = await client.get("/api/data");
      assert.strictEqual(requestCount, 1);
      assert.strictEqual(r3.data.count, 1);
    } finally {
      server.close();
    }
  });

  it("4. Cancellation via dotMix CancellationToken (D-104)", async () => {
    const server = httpNode.createServer((req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end("Done");
      }, 200);
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    try {
      const client = createHttpClient({ baseURL: `http://127.0.0.1:${port}` });
      const cts = createCancellationTokenSource();

      const reqPromise = client.get("/api/long", { cancelToken: cts.token });
      setTimeout(() => cts.cancel(), 20);

      await assert.rejects(
        reqPromise,
        (err) => isHttpError(err) && err.isCancelled === true
      );
    } finally {
      server.close();
    }
  });

  it("5. Reactive useHttp hook with signal states", async () => {
    const server = httpNode.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Hello from useHttp" }));
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    try {
      const { data, loading, error, execute } = useHttp<{ message: string }>(
        `http://127.0.0.1:${port}/api/hello`,
        { immediate: false }
      );

      assert.strictEqual(loading(), false);
      assert.strictEqual(data(), undefined);
      assert.strictEqual(error(), null);

      await execute();
      assert.strictEqual(loading(), false);
      assert.deepStrictEqual(data(), { message: "Hello from useHttp" });
    } finally {
      server.close();
    }
  });
});
