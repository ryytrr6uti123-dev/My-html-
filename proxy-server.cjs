
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);

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

const server = http.createServer((req, res) => {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  if (requestUrl.pathname === "/healthz") {
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8"
    });
    return res.end("ok");
  }

  const requestedPath =
    requestUrl.pathname === "/"
      ? "index.html"
      : decodeURIComponent(requestUrl.pathname.slice(1));

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
      res.writeHead(404, {
        "content-type": "text/plain"
      });
      return res.end("Not found");
    }

    const extension = path.extname(filePath).toLowerCase();

    res.writeHead(200, {
      "content-type": mimeTypes[extension] || "application/octet-stream",
      "x-content-type-options": "nosniff"
    });

    res.end(data);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`NEXUS running on port ${port}`);
});
