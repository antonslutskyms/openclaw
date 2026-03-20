import { Type } from "@sinclair/typebox";
import {
  buildSearchCacheKey,
  DEFAULT_SEARCH_COUNT,
  MAX_SEARCH_COUNT,
  enablePluginInConfig,
  formatCliCommand,
  getScopedCredentialValue,
  readCachedSearchPayload,
  readConfiguredSecretString,
  readNumberParam,
  readProviderEnvValue,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  resolveSearchCacheTtlMs,
  resolveSearchCount,
  resolveSearchTimeoutSeconds,
  resolveSiteName,
  setProviderWebSearchPluginConfigValue,
  setScopedCredentialValue,
  type SearchConfigRecord,
  type WebSearchProviderPlugin,
  type WebSearchProviderToolDefinition,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";

const BING_DEFAULT_ENDPOINT = "https://api.bing.microsoft.com/v7.0/search";

type BingWebPage = {
  name?: string;
  url?: string;
  snippet?: string;
  datePublished?: string;
  dateLastCrawled?: string;
};

type BingSearchResponse = {
  webPages?: { value?: BingWebPage[] };
};

function getBingScoped(searchConfig?: SearchConfigRecord): Record<string, unknown> | undefined {
  const raw = searchConfig?.bing;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

function resolveBingApiKey(searchConfig?: SearchConfigRecord): string | undefined {
  const scoped = getBingScoped(searchConfig);
  return (
    readConfiguredSecretString(scoped?.apiKey, "plugins.entries.bing.config.webSearch.apiKey") ??
    readProviderEnvValue(["BING_SEARCH_API_KEY"])
  );
}

function resolveBingEndpoint(searchConfig?: SearchConfigRecord): string {
  const scoped = getBingScoped(searchConfig);
  const ep = typeof scoped?.endpoint === "string" ? scoped.endpoint.trim() : "";
  if (ep) {
    try {
      return new URL(ep).toString();
    } catch {
      return BING_DEFAULT_ENDPOINT;
    }
  }
  return BING_DEFAULT_ENDPOINT;
}

function resolveBingDefaultMkt(searchConfig?: SearchConfigRecord): string | undefined {
  const scoped = getBingScoped(searchConfig);
  const mkt = typeof scoped?.mkt === "string" ? scoped.mkt.trim() : "";
  return mkt || undefined;
}

function resolveBingDefaultSafesearch(searchConfig?: SearchConfigRecord): "Off" | "Moderate" | "Strict" {
  const scoped = getBingScoped(searchConfig);
  const raw = typeof scoped?.safesearch === "string" ? scoped.safesearch.trim() : "";
  if (raw === "Off" || raw === "Moderate" || raw === "Strict") {
    return raw;
  }
  return "Moderate";
}

function normalizeSafesearchParam(value: string | undefined, fallback: "Off" | "Moderate" | "Strict") {
  if (!value?.trim()) {
    return fallback;
  }
  const lower = value.trim().toLowerCase();
  if (lower === "off") {
    return "Off" as const;
  }
  if (lower === "strict") {
    return "Strict" as const;
  }
  if (lower === "moderate") {
    return "Moderate" as const;
  }
  return undefined;
}

export function mapBingWebPages(data: BingSearchResponse): Array<Record<string, unknown>> {
  const pages = Array.isArray(data.webPages?.value) ? (data.webPages?.value ?? []) : [];
  return pages.map((entry) => {
    const snippet = entry.snippet ?? "";
    const title = entry.name ?? "";
    const url = entry.url ?? "";
    const published = entry.datePublished || entry.dateLastCrawled || undefined;
    return {
      title: title ? wrapWebContent(title, "web_search") : "",
      url,
      description: snippet ? wrapWebContent(snippet, "web_search") : "",
      published,
      siteName: resolveSiteName(url) || undefined,
    };
  });
}

async function runBingWebSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  endpoint: string;
  timeoutSeconds: number;
  mkt?: string;
  safesearch: "Off" | "Moderate" | "Strict";
}): Promise<Array<Record<string, unknown>>> {
  const url = new URL(params.endpoint);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));
  url.searchParams.set("responseFilter", "Webpages");
  if (params.mkt) {
    url.searchParams.set("mkt", params.mkt);
  }
  url.searchParams.set("safesearch", params.safesearch);

  return withTrustedWebSearchEndpoint(
    {
      url: url.toString(),
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Ocp-Apim-Subscription-Key": params.apiKey,
        },
      },
    },
    async (res) => {
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Bing Web Search API error (${res.status}): ${detail || res.statusText}`);
      }
      const data = (await res.json()) as BingSearchResponse;
      return mapBingWebPages(data);
    },
  );
}

function createBingSchema() {
  return Type.Object({
    query: Type.String({ description: "Search query string." }),
    count: Type.Optional(
      Type.Number({
        description: "Number of results to return (1-10).",
        minimum: 1,
        maximum: MAX_SEARCH_COUNT,
      }),
    ),
    mkt: Type.Optional(
      Type.String({
        description:
          "Optional Bing market/locale (e.g. en-US, en-GB). Overrides default from config when set.",
      }),
    ),
    safesearch: Type.Optional(
      Type.String({
        description: "SafeSearch level: off, moderate, or strict (default from config or moderate).",
      }),
    ),
  });
}

function missingBingKeyPayload() {
  return {
    error: "missing_bing_search_api_key",
    message: `web_search (bing) needs a Bing Web Search API key. Run \`${formatCliCommand("openclaw configure --section web")}\` to store it, or set BING_SEARCH_API_KEY in the Gateway environment.`,
    docs: "https://docs.openclaw.ai/tools/web",
  };
}

function createBingToolDefinition(searchConfig?: SearchConfigRecord): WebSearchProviderToolDefinition {
  const defaultMkt = resolveBingDefaultMkt(searchConfig);
  const defaultSafe = resolveBingDefaultSafesearch(searchConfig);

  return {
    description:
      "Search the web using the Bing Web Search API (Azure). Returns titles, URLs, and snippets.",
    parameters: createBingSchema(),
    execute: async (args) => {
      const apiKey = resolveBingApiKey(searchConfig);
      if (!apiKey) {
        return missingBingKeyPayload();
      }

      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const count =
        readNumberParam(params, "count", { integer: true }) ?? searchConfig?.maxResults ?? undefined;
      const mktArg = readStringParam(params, "mkt");
      const mkt = mktArg?.trim() || defaultMkt;
      const rawSafe = readStringParam(params, "safesearch");
      const safesearch = normalizeSafesearchParam(rawSafe, defaultSafe);
      if (rawSafe?.trim() && safesearch === undefined) {
        return {
          error: "invalid_safesearch",
          message: "safesearch must be off, moderate, or strict.",
          docs: "https://docs.openclaw.ai/tools/web",
        };
      }

      const endpoint = resolveBingEndpoint(searchConfig);
      const cacheKey = buildSearchCacheKey([
        "bing",
        endpoint,
        query,
        resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
        mkt ?? "",
        safesearch ?? defaultSafe,
      ]);
      const cached = readCachedSearchPayload(cacheKey);
      if (cached) {
        return cached;
      }

      const start = Date.now();
      const timeoutSeconds = resolveSearchTimeoutSeconds(searchConfig);
      const cacheTtlMs = resolveSearchCacheTtlMs(searchConfig);

      const results = await runBingWebSearch({
        query,
        count: resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
        apiKey,
        endpoint,
        timeoutSeconds,
        mkt,
        safesearch: safesearch ?? defaultSafe,
      });

      const payload = {
        query,
        provider: "bing",
        count: results.length,
        tookMs: Date.now() - start,
        externalContent: {
          untrusted: true,
          source: "web_search",
          provider: "bing",
          wrapped: true,
        },
        results,
      };
      writeCachedSearchPayload(cacheKey, payload, cacheTtlMs);
      return payload;
    },
  };
}

export function createBingWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "bing",
    label: "Bing Web Search",
    hint: "Structured results · Azure Bing Search v7",
    envVars: ["BING_SEARCH_API_KEY"],
    placeholder: "Azure subscription key",
    signupUrl: "https://www.microsoft.com/en-us/bing/apis/bing-web-search-api",
    docsUrl: "https://docs.openclaw.ai/bing-search",
    autoDetectOrder: 25,
    credentialPath: "plugins.entries.bing.config.webSearch.apiKey",
    inactiveSecretPaths: ["plugins.entries.bing.config.webSearch.apiKey"],
    getCredentialValue: (searchConfig) => getScopedCredentialValue(searchConfig, "bing"),
    setCredentialValue: (searchConfigTarget, value) =>
      setScopedCredentialValue(searchConfigTarget, "bing", value),
    getConfiguredCredentialValue: (config) =>
      resolveProviderWebSearchPluginConfig(config, "bing")?.apiKey,
    setConfiguredCredentialValue: (configTarget, value) => {
      setProviderWebSearchPluginConfigValue(configTarget, "bing", "apiKey", value);
    },
    applySelectionConfig: (config) => enablePluginInConfig(config, "bing").config,
    createTool: (ctx) =>
      createBingToolDefinition(
        (() => {
          const searchConfig = ctx.searchConfig as SearchConfigRecord | undefined;
          const pluginConfig = resolveProviderWebSearchPluginConfig(ctx.config, "bing");
          if (!pluginConfig) {
            return searchConfig;
          }
          const prior = getBingScoped(searchConfig) ?? {};
          return {
            ...(searchConfig ?? {}),
            bing: { ...prior, ...pluginConfig },
          } as SearchConfigRecord;
        })(),
      ),
  };
}

export const __testing = {
  mapBingWebPages,
  normalizeSafesearchParam,
  resolveBingEndpoint,
} as const;
