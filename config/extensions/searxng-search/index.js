const SEARXNG_BASE = "http://192.168.107.6:8080";

export default function register(api) {
  api.registerTool({
    name: "web_search_local",
    label: "Web Search (Local)",
    description:
      "Search the web using a local SearXNG instance. " +
      "Returns titles, URLs, and snippets for each result. " +
      "Use this for any web search queries.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string",
        },
        language: {
          type: "string",
          description: "Language code for search results (e.g. zh-TW, en, ja)",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default 10)",
        },
      },
      required: ["query"],
    },

    async execute(_id, params) {
      const query = typeof params.query === "string" ? params.query.trim() : "";
      if (!query) {
        return { content: [{ type: "text", text: "query is required" }] };
      }

      const language = typeof params.language === "string" ? params.language.trim() : "zh-TW";
      const maxResults = typeof params.max_results === "number" && params.max_results > 0
        ? params.max_results
        : 10;

      const searchUrl = new URL("/search", SEARXNG_BASE);
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("format", "json");
      searchUrl.searchParams.set("language", language);

      try {
        const res = await fetch(searchUrl.toString(), {
          headers: { "Accept": "application/json" },
        });

        if (!res.ok) {
          const errBody = await res.text();
          return {
            content: [{
              type: "text",
              text: "SearXNG error: " + res.status + " " + errBody.substring(0, 500),
            }],
          };
        }

        const data = await res.json();
        const results = Array.isArray(data.results) ? data.results : [];

        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: 'No results found for "' + query + '".',
            }],
          };
        }

        const limited = results.slice(0, maxResults);
        const lines = [];
        lines.push("Search results for: " + query);
        lines.push("Results: " + limited.length + " of " + results.length + " total");
        lines.push("");

        for (let i = 0; i < limited.length; i++) {
          const r = limited[i];
          const title = r.title || "(no title)";
          const url = r.url || "";
          const snippet = r.content || r.snippet || "";

          lines.push((i + 1) + ". " + title);
          lines.push("   " + url);
          if (snippet) {
            lines.push("   " + snippet);
          }
          lines.push("");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: "SearXNG connection failed: " + err.message,
          }],
        };
      }
    },
  }, { optional: false });
}
