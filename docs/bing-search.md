---
summary: "Bing Web Search API setup for web_search"
read_when:
  - You want Bing (Azure) as the web_search provider
  - You need BING_SEARCH_API_KEY or plugin config paths
title: "Bing Web Search"
---

# Bing Web Search API

OpenClaw includes a bundled plugin that uses the [Bing Web Search API v7](https://www.microsoft.com/en-us/bing/apis/bing-web-search-api) (Azure Cognitive Services).

## Get an API key

1. Create a Bing Search resource in [Azure Portal](https://portal.azure.com/) (or use an existing Cognitive Services multi-service resource with Bing Search enabled).
2. Copy the **Key** from **Keys and Endpoint**.
3. Store it with `openclaw configure --section web` and choose **Bing Web Search**, or set `BING_SEARCH_API_KEY` in the Gateway environment (`~/.openclaw/.env`).

## Config example

```json5
{
  plugins: {
    entries: {
      bing: {
        enabled: true,
        config: {
          webSearch: {
            apiKey: "YOUR_AZURE_KEY",
            // Optional overrides:
            // endpoint: "https://api.bing.microsoft.com/v7.0/search",
            // mkt: "en-US",
            // safesearch: "Moderate",
          },
        },
      },
    },
  },
  tools: {
    web: {
      search: {
        provider: "bing",
        maxResults: 5,
        timeoutSeconds: 30,
      },
    },
  },
}
```

Provider-specific settings live under `plugins.entries.bing.config.webSearch.*`.

## Tool parameters

| Parameter    | Description                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| `query`      | Search query (required)                                                     |
| `count`      | Number of results (1–10)                                                    |
| `mkt`        | Bing market/locale (e.g. `en-US`, `de-DE`); overrides default from config  |
| `safesearch` | `off`, `moderate`, or `strict` (Bing default from config is **Moderate**)   |

See [Web tools](/tools/web) for shared `web_search` options (cache, timeouts).
