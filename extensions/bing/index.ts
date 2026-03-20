import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { createBingWebSearchProvider } from "./src/bing-web-search-provider.js";

export default definePluginEntry({
  id: "bing",
  name: "Bing Web Search Plugin",
  description: "Bing Web Search API (Azure Cognitive Search) for web_search",
  register(api) {
    api.registerWebSearchProvider(createBingWebSearchProvider());
  },
});
