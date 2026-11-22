const http = require("http");
const fs = require("fs");
const path = require("path");
const dns = require("dns");
const { promisify } = require("util");

const lookup = promisify(dns.lookup);
const root = __dirname;
const port = Number(process.env.PORT || 4173);

function isPrivateAddress(address) {
  if (address.includes(":")) {
    return address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
  }
  const parts = address.split(".").map(Number);
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254);
}

async function isAllowedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  try {
    const address = await lookup(url.hostname, { verbatim: true });
    if (isPrivateAddress(address.address)) return null;
  } catch {
    return null;
  }
  return url;
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function proxyUrl(base, value) {
  if (!value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("javascript:") ||
      value.startsWith("#") || value.startsWith("mailto:") || value.startsWith("tel:")) return value;
  let absolute;
  try {
    absolute = new URL(value, base).toString();
  } catch {
    return value;
  }
  if (!/^https?:/i.test(absolute)) return absolute;
  return `/proxy?url=${encodeURIComponent(absolute)}`;
}

function rewriteHtml(html, baseUrl) {
  html = html.replace(/<base[^>]*>/gi, "");
  html = html.replace(/(<(?:a|link|script|img|iframe|source|video|audio|form|button)\b[^>]*?\b(?:href|src|action|poster)\s*=\s*)(["'])(.*?)\2/gi,
    (match, prefix, quote, value) => `${prefix}${quote}${escapeHtml(proxyUrl(baseUrl, value))}${quote}`);
  html = html.replace(/((?:srcset)\s*=\s*)(["'])(.*?)\2/gi, (match, prefix, quote, value) =>
    `${prefix}${quote}${value.split(",").map(part => {
      const [source, descriptor] = part.trim().split(/\s+/);
      return `${proxyUrl(baseUrl, source)}${descriptor ? ` ${descriptor}` : ""}`;
    }).join(", ")}${quote}`);
  html = html.replace(/<(head)(?:\s[^>]*)?>/i, `<$1><base href="${escapeHtml(baseUrl)}">`);

  const bridge = `<script>
(function(){
  var originalOpen=window.open;
  window.open=function(url){if(url){location.assign(url)};return null};
  document.addEventListener("click",function(event){
    var link=event.target.closest("a");
    if(!link)return;
    var target=link.getAttribute("target");
    if(target&&target.toLowerCase()==="_blank"){event.preventDefault();event.stopPropagation();link.removeAttribute("target");link.click()}
  },true);
})();</script>`;
  return html.replace(/<head/i, "<head").replace(/<head[^>]*>/i, match => match + bridge);
}

async function fetchRemote(url, requestHeaders) {
  let current = url;
  for (let redirect = 0; redirect < 5; redirect++) {
    const allowed = await isAllowedUrl(current);
    if (!allowed) throw new Error("Blocked URL");
    const upstream = await fetch(allowed.toString(), {
      redirect: "manual",
      headers: {
        "user-agent": requestHeaders["user-agent"] || "Mozilla/5.0",
        "accept": requestHeaders.accept || "*/*"
      }
    });
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get("location")) {
      current = new URL(upstream.headers.get("location"), allowed).toString();
      continue;
    }
    return { response: upstream, url: allowed };
  }
  throw new Error("Too many redirects");
}

async function handleProxy(req, res, target) {
  const allowed = await isAllowedUrl(target);
  if (!allowed) {
    res.writeHead(403, {"content-type": "text/plain"});
    res.end("This URL is not allowed.");
    return;
  }
  try {
    const result = await fetchRemote(allowed.toString(), req.headers);
    const contentType = result.response.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await result.response.arrayBuffer());
    res.setHeader("cache-control", "no-store");
    res.removeHeader("content-security-policy");
    res.setHeader("x-frame-options", "SAMEORIGIN");
    if (/text\/html/i.test(contentType)) {
      let html = body.toString("utf8");
      html = rewriteHtml(html, result.url.toString());
      res.writeHead(result.response.status, {"content-type": "text/html; charset=utf-8"});
      res.end(html);
    } else {
      res.writeHead(result.response.status, {
        "content-type": contentType,
        "cross-origin-resource-policy": "cross-origin"
      });
      res.end(body);
    }
  } catch (error) {
    res.writeHead(502, {"content-type": "text/plain"});
    res.end(`Unable to load this website: ${error.message}`);
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (requestUrl.pathname === "/proxy") {
    await handleProxy(req, res, requestUrl.searchParams.get("url"));
    return;
  }
  const requested = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
  const filePath = path.resolve(root, requested);
  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, {"content-type": "text/plain"});
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const types = {".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml"};
    res.writeHead(200, {"content-type": types[ext] || "application/octet-stream"});
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`NEXUS browser running at http://127.0.0.1:${port}`);
});
