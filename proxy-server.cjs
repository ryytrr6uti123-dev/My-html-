const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);

const allowedHosts = new Set([
  "html.duckduckgo.com",
  "search.brave.com",
  "www.bing.com",
  "www.google.com"
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

async function handleProxy(req, res, requestUrl) {
  if (req.method !== "GET") {
    res.writeHead(405);
    return res.end("Method not allowed");
  }

  const target = requestUrl.searchParams.get("url");

  if (!target) {
    res.writeHead(400);
    return res.end("Missing url parameter");
  }

  let destination;

  try {
    destination = new URL(target);
  } catch {
    res.writeHead(400);
    return res.end("Invalid URL");
  }

  if (
    destination.protocol !== "https:" ||
    destination.username ||
    destination.password ||
    destination.port ||
    !allowedHosts.has(destination.hostname)
  ) {
    res.writeHead(403);
    return res.end("Destination not allowed");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const upstream = await fetch(destination, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "NEXUS/1.0"
      }
    });

    // Redirects are disabled until their destinations
    // can be checked against the allowlist.
    if (upstream.status >= 300 && upstream.status < 400) {
      res.writeHead(502);
      return res.end("Redirect not supported");
    }

    const data = Buffer.from(await upstream.arrayBuffer());

    if (data.length > 5 * 1024 * 1024) {
      res.writeHead(413);
      return res.end("Response too large");
    }

    res.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") ||
        "application/octet-stream",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store"
    });

    res.end(data);
  } catch {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Proxy request failed");
    }
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer((req, res) => {
  let requestUrl;

  try {
    requestUrl = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }

  if (requestUrl.pathname === "/healthz") {
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8"
    });
    return res.end("ok");
  }

  if (requestUrl.pathname === "/proxy") {
    return handleProxy(req, res, requestUrl);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end("Method not allowed");
  }

  let requestedPath;

  try {
    requestedPath =
      requestUrl.pathname === "/"
        ? "index.html"
        : decodeURIComponent(requestUrl.pathname.slice(1));
  } catch {
    res.writeHead(400);
    return res.end("Bad path");
  }

  const filePath = path.resolve(root, requestedPath);

  if (
    filePath !== root &&
    !filePath.startsWith(root + path.sep)
  ) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const extension = path.extname(filePath).toLowerCase();

    res.writeHead(200, {
      "content-type":
        mimeTypes[extension] || "application/octet-stream",
      "x-content-type-options": "nosniff"
    });

    res.end(req.method === "HEAD" ? undefined : data);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`NEXUS running on port ${port}`);
});
