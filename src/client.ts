// hubNote REST API client. 각 도구가 이 client 를 통해 백엔드 호출.
// 모든 요청은 `Authorization: Bearer hbn_...` 헤더로 인증.
//
// 4xx / 5xx 응답은 `HubNoteError` 로 정규화 — MCP 도구 코드는
// `error.code` 만 보고 사용자에게 친절한 에러를 반환합니다.

import type { ApiErrorBody } from "./types.js";

export type ErrorCode =
  | "auth_failed"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "unknown";

export class HubNoteError extends Error {
  code: ErrorCode;
  status: number;
  body: ApiErrorBody | null;

  constructor(
    message: string,
    code: ErrorCode,
    status: number,
    body: ApiErrorBody | null = null,
  ) {
    super(message);
    this.name = "HubNoteError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

function statusToCode(status: number): ErrorCode {
  if (status === 401) return "auth_failed";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unknown";
}

interface ClientOptions {
  apiKey: string;
  baseUrl: string;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export class HubNoteClient {
  private apiKey: string;
  private baseUrl: string;

  constructor({ apiKey, baseUrl }: ClientOptions) {
    if (!apiKey.startsWith("hbn_")) {
      throw new Error(
        "HUBNOTE_API_KEY must start with `hbn_`. Get one from your hubNote " +
          "account settings → API 키 tab.",
      );
    }
    if (!/^https?:\/\//.test(baseUrl)) {
      throw new Error(
        "HUBNOTE_URL must be an absolute URL (e.g. https://notion.discof.com)",
      );
    }
    this.apiKey = apiKey;
    // Trailing slash 제거 — 모든 path 는 leading slash 로 시작합니다.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { method = "GET", body, query } = options;

    let url = `${this.baseUrl}/api${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HubNoteError(
        `Network error: ${msg}`,
        "network_error",
        0,
      );
    }

    // 204 No Content 는 빈 응답 그대로.
    if (response.status === 204) {
      return undefined as T;
    }

    let parsed: unknown = null;
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
    } else {
      parsed = await response.text();
    }

    if (!response.ok) {
      const code = statusToCode(response.status);
      const errBody =
        parsed && typeof parsed === "object" ? (parsed as ApiErrorBody) : null;
      const detail = errBody?.detail;
      const detailMsg =
        typeof detail === "string"
          ? detail
          : detail
            ? JSON.stringify(detail)
            : `HTTP ${response.status}`;
      throw new HubNoteError(detailMsg, code, response.status, errBody);
    }

    return parsed as T;
  }
}
