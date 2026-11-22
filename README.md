# NEXUS

The site is a static HTML page. Inline web search needs a small hosted Cloudflare Worker because search providers block their full results pages from being embedded directly.

## Set up inline search

1. In the Cloudflare dashboard, open **Workers & Pages**, create a Worker, and replace its starter code with [`search-worker.js`](./search-worker.js). Deploy it.
2. Copy the Worker URL, which looks like `https://worker-name.account-name.workers.dev`.
3. In [`index.html`](./index.html), replace `https://nexus-search.YOUR-CLOUDFLARE-SUBDOMAIN.workers.dev/search` in `SEARCH_API_URL` with your Worker URL followed by `/search`.
4. Open `index.html` directly or use the GitHub Pages site. Search results render inside the page; selecting a result opens that destination in a new tab.

The Worker queries Bing's RSS search results for personal, non-commercial use and returns only the result title, URL, and description. No search query is stored by this project.
