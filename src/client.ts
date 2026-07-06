import type { Config } from "./config.js";
import { VERSION } from "./version.js";

export type QueryParams = Record<
  string,
  string | number | boolean | undefined
>;

export class WarpClient {
  private baseUrl: string;
  private apiToken: string | null;
  private timeoutMs: number;

  get isAnonymous(): boolean {
    return this.apiToken === null;
  }

  constructor(config: Config) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiToken = config.apiToken;
    this.timeoutMs = config.requestTimeoutMs;
  }

  async get(path: string, params?: QueryParams): Promise<unknown> {
    return this.request(this.buildUrl(path, params), { method: "GET" });
  }

  async post(
    path: string,
    body?: unknown,
    params?: QueryParams,
    opts?: { headers?: Record<string, string> }
  ): Promise<unknown> {
    return this.request(this.buildUrl(path, params), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...opts?.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // Multipart upload: reads a local file and posts it as form-data.
  async postForm(
    path: string,
    fields: Record<string, string | undefined>,
    file?: { field: string; filePath: string }
  ): Promise<unknown> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) form.set(key, value);
    }
    if (file) {
      const { readFile } = await import("node:fs/promises");
      const { basename } = await import("node:path");
      const data = await readFile(file.filePath);
      form.set(
        file.field,
        new Blob([new Uint8Array(data)]),
        basename(file.filePath)
      );
    }
    return this.request(this.buildUrl(path), {
      method: "POST",
      body: form,
    });
  }

  async put(path: string, body?: unknown): Promise<unknown> {
    return this.request(this.buildUrl(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async patch(path: string, body?: unknown): Promise<unknown> {
    return this.request(this.buildUrl(path), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async delete(
    path: string,
    params?: QueryParams,
    body?: unknown
  ): Promise<unknown> {
    return this.request(this.buildUrl(path, params), {
      method: "DELETE",
      ...(body !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(this.baseUrl + path);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...((init.headers as Record<string, string>) || {}),
          ...this.authHeaders(),
          Accept: "application/json",
          "User-Agent": `warp-mcp/${VERSION}`,
        },
      });

      const text = await response.text();

      if (!response.ok) {
        return {
          _error: true,
          status: response.status,
          message: this.describeHttpError(response.status),
          body: this.tryParseJson(text),
        };
      }

      return this.tryParseJson(text);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          _error: true,
          status: 0,
          message: `Request timed out after ${this.timeoutMs}ms`,
        };
      }
      return {
        _error: true,
        status: 0,
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiToken) return {};
    return { Authorization: "Bearer " + this.apiToken };
  }

  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private describeHttpError(status: number): string {
    switch (status) {
      case 400:
        return "Bad request — check parameter format";
      case 401:
      case 403:
        return this.apiToken
          ? "Authentication failed — your WARP API key was rejected or lacks the required scope. Check WARP_API_TOKEN or run `npx warp-mcp setup`."
          : "No API key configured. Run `npx warp-mcp setup` or set WARP_API_TOKEN. Keys are minted in the WARP portal under Settings → API Keys.";
      case 404:
        return "Not found";
      case 429:
        return "Rate limit exceeded — wait and retry";
      case 502:
      case 503:
        return "Service temporarily unavailable";
      default:
        return `HTTP ${status}`;
    }
  }
}
