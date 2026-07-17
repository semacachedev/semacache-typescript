/**
 * SemaCache TypeScript SDK — standalone HTTP client for semacache.io.
 * Zero dependencies on OpenAI.
 *
 * @example
 * ```ts
 * import { SemaCache } from "semacache";
 *
 * const client = new SemaCache({ apiKey: "sc-your-key" });
 *
 * const response = await client.chat.completions.create({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "Hello" }],
 * });
 * console.log(response.choices[0].message.content);
 * console.log(response.cache.matchType); // "EXACT" | "SEMANTIC" | null
 * ```
 */

const DEFAULT_BASE_URL = "https://www.semacache.io/api/v1";

export interface SemaCacheOptions {
  apiKey: string;
  baseUrl?: string;
  upstreamApiKey?: string;
  similarityThreshold?: number;
  cacheTtl?: number;
  timeout?: number;
}

export interface Message {
  role: string;
  content: string;
}

export interface Choice {
  index: number;
  message: Message;
  finish_reason: string | null;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CacheInfo {
  matchType: string | null;
  confidence: number | null;
  latencyMs: number | null;
}

export interface ChatCompletion {
  id: string;
  model: string;
  choices: Choice[];
  usage: Usage;
  cache: CacheInfo;
  raw: Record<string, unknown>;
}

export interface CreateParams {
  model: string;
  messages: Array<{ role: string; content: string }>;
  similarityThreshold?: number;
  cacheTtl?: number;
  noCache?: boolean;
  noStore?: boolean;
  [key: string]: unknown;
}

export interface ImageGenerateParams {
  prompt: string;
  model?: string;
  n?: number;
  size?: string;
  quality?: string;
  similarityThreshold?: number;
  cacheTtl?: number;
  noCache?: boolean;
  noStore?: boolean;
  /**
   * Any other key (``style``, ``response_format``, ``seed``, ``negative_prompt``,
   * ``extra_body``, …) is forwarded to the upstream provider verbatim.
   */
  [key: string]: unknown;
}

export interface ImageData {
  url: string;
}

export interface ImageGeneration {
  data: ImageData[];
  cache: CacheInfo;
  raw: Record<string, unknown>;
}

export interface VideoGenerateParams {
  prompt: string;
  model?: string;
  duration_seconds?: number;
  aspect_ratio?: string;
  n?: number;
  similarityThreshold?: number;
  cacheTtl?: number;
  noCache?: boolean;
  noStore?: boolean;
  /**
   * Any other key (``negative_prompt``, ``seed``, ``resolution``,
   * ``enhance_prompt``, ``extra_body``, …) is forwarded to the upstream
   * provider verbatim.
   */
  [key: string]: unknown;
}

export interface VideoData {
  url: string;
}

export interface VideoGeneration {
  data: VideoData[];
  cache: CacheInfo;
  raw: Record<string, unknown>;
}

export class SemaCache {
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeout: number;

  public chat = {
    completions: {
      create: (params: CreateParams): Promise<ChatCompletion> =>
        this._createCompletion(params),
    },
  };

  public images = {
    generate: (params: ImageGenerateParams): Promise<ImageGeneration> =>
      this._generateImage(params),
  };

  public videos = {
    generate: (params: VideoGenerateParams): Promise<VideoGeneration> =>
      this._generateVideo(params),
  };

  constructor(options: SemaCacheOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = options.timeout ?? 120_000;

    this.headers = {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    };
    if (options.upstreamApiKey) {
      this.headers["x-upstream-api-key"] = options.upstreamApiKey;
    }
    if (options.similarityThreshold !== undefined) {
      this.headers["x-similarity-threshold"] = String(options.similarityThreshold);
    }
    if (options.cacheTtl !== undefined) {
      this.headers["x-cache-ttl"] = String(options.cacheTtl);
    }
  }

  private async _createCompletion(params: CreateParams): Promise<ChatCompletion> {
    const {
      model,
      messages,
      similarityThreshold,
      cacheTtl,
      noCache,
      noStore,
      ...rest
    } = params;

    const reqHeaders: Record<string, string> = { ...this.headers };
    if (similarityThreshold !== undefined) {
      reqHeaders["x-similarity-threshold"] = String(similarityThreshold);
    }
    if (cacheTtl !== undefined) {
      reqHeaders["x-cache-ttl"] = String(cacheTtl);
    }
    if (noCache) {
      reqHeaders["Cache-Control"] = "no-cache";
    } else if (noStore) {
      reqHeaders["Cache-Control"] = "no-store";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({ model, messages, ...rest }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`SemaCache API error ${res.status}: ${text}`);
      }

      const data = await res.json();

      const conf = res.headers.get("x-semcache-confidence");
      const lat = res.headers.get("x-semcache-latency-ms");

      const cache: CacheInfo = {
        matchType: res.headers.get("x-semcache-match-type"),
        confidence: conf ? parseFloat(conf) : null,
        latencyMs: lat ? parseFloat(lat) : null,
      };

      return {
        id: data.id ?? "",
        model: data.model ?? "",
        choices: (data.choices ?? []).map((c: Record<string, unknown>, i: number) => ({
          index: (c.index as number) ?? i,
          message: {
            role: (c.message as Record<string, string>)?.role ?? "",
            content: (c.message as Record<string, string>)?.content ?? "",
          },
          finish_reason: (c.finish_reason as string) ?? null,
        })),
        usage: {
          prompt_tokens: (data.usage?.prompt_tokens as number) ?? 0,
          completion_tokens: (data.usage?.completion_tokens as number) ?? 0,
          total_tokens: (data.usage?.total_tokens as number) ?? 0,
        },
        cache,
        raw: data,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  private _buildCacheHeaders(
    opts: { similarityThreshold?: number; cacheTtl?: number; noCache?: boolean; noStore?: boolean },
  ): Record<string, string> {
    const h: Record<string, string> = { ...this.headers };
    if (opts.similarityThreshold !== undefined) h["x-similarity-threshold"] = String(opts.similarityThreshold);
    if (opts.cacheTtl !== undefined) h["x-cache-ttl"] = String(opts.cacheTtl);
    if (opts.noCache) h["Cache-Control"] = "no-cache";
    else if (opts.noStore) h["Cache-Control"] = "no-store";
    return h;
  }

  private _parseCacheInfo(res: Response): CacheInfo {
    const conf = res.headers.get("x-semcache-confidence");
    const lat = res.headers.get("x-semcache-latency-ms");
    return {
      matchType: res.headers.get("x-semcache-match-type"),
      confidence: conf ? parseFloat(conf) : null,
      latencyMs: lat ? parseFloat(lat) : null,
    };
  }

  private async _post(path: string, body: Record<string, unknown>, headers: Record<string, string>): Promise<{ data: Record<string, unknown>; res: Response }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`SemaCache API error ${res.status}: ${text}`);
      }
      const data = await res.json();
      return { data, res };
    } finally {
      clearTimeout(timer);
    }
  }

  private async _generateImage(params: ImageGenerateParams): Promise<ImageGeneration> {
    const {
      prompt, model, n, size, quality,
      similarityThreshold, cacheTtl, noCache, noStore,
      ...extras
    } = params;
    const headers = this._buildCacheHeaders({ similarityThreshold, cacheTtl, noCache, noStore });
    const body: Record<string, unknown> = {
      prompt,
      model: model ?? "gpt-image-1",
      n: n ?? 1,
      size: size ?? "1024x1024",
      quality: quality ?? "standard",
      ...extras,
    };
    const { data, res } = await this._post("/images/generations", body, headers);
    return {
      data: ((data as Record<string, unknown>).data as Array<Record<string, string>> ?? []).map((d) => ({ url: d.url ?? "" })),
      cache: this._parseCacheInfo(res),
      raw: data as Record<string, unknown>,
    };
  }

  private async _generateVideo(params: VideoGenerateParams): Promise<VideoGeneration> {
    const {
      prompt, model, duration_seconds, aspect_ratio, n,
      similarityThreshold, cacheTtl, noCache, noStore,
      ...extras
    } = params;
    const headers = this._buildCacheHeaders({ similarityThreshold, cacheTtl, noCache, noStore });
    const body: Record<string, unknown> = {
      prompt,
      model: model ?? "veo-2.0-generate-001",
      duration_seconds: duration_seconds ?? 8,
      aspect_ratio: aspect_ratio ?? "16:9",
      n: n ?? 1,
      ...extras,
    };
    const { data, res } = await this._post("/videos/generations", body, headers);
    return {
      data: ((data as Record<string, unknown>).data as Array<Record<string, string>> ?? []).map((d) => ({ url: d.url ?? "" })),
      cache: this._parseCacheInfo(res),
      raw: data as Record<string, unknown>,
    };
  }
}

export default SemaCache;
