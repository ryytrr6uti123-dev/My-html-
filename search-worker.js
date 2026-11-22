function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function emptyResponse(status = 204) {
  return new Response(null, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
      if (code[0] === "#") {
        const point = code[1].toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
        return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "\uFFFD";
      }
      return {amp:"&",lt:"<",gt:">",quot:'"',apos:"'"}[code.toLowerCase()];
    })
    .trim();
}

function readTag(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseResults(xml) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map(([, item]) => ({
      title: readTag(item, "title"),
      url: readTag(item, "link"),
      description: readTag(item, "description")
    }))
    .filter(result => result.title && /^https?:\/\//i.test(result.url))
    .slice(0, 20);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return emptyResponse();
    if (request.method !== "GET") return jsonResponse({error:"Only GET requests are supported."}, 405);
    if (url.pathname !== "/search") return jsonResponse({error:"Not found."}, 404);

    const query = (url.searchParams.get("q") || "").trim();
    if (!query) return jsonResponse({error:"Enter a search query."}, 400);
    if (query.length > 200) return jsonResponse({error:"Search queries must be 200 characters or fewer."}, 400);

    const searchUrl = new URL("https://www.bing.com/search");
    searchUrl.searchParams.set("format", "rss");
    searchUrl.searchParams.set("q", query);

    try {
      const upstream = await fetch(searchUrl, {
        headers: {accept:"application/rss+xml, application/xml;q=0.9, */*;q=0.8"}
      });
      if (!upstream.ok) return jsonResponse({error:`Search provider returned ${upstream.status}.`}, 502);
      const xml = await upstream.text();
      const results = parseResults(xml);
      if (!results.length) return jsonResponse({error:"The search provider returned no readable results."}, 502);
      return jsonResponse({results});
    } catch (error) {
      return jsonResponse({error:`Search request failed: ${error.message}`}, 502);
    }
  }
};
