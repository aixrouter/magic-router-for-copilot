export class AIXRouterHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
  ) {
    super(message);
    this.name = 'AIXRouterHttpError';
  }
}

export interface UpstreamErrorPayload {
  readonly code?: string;
  readonly message?: string;
  readonly type?: string;
  readonly param?: string;
  readonly requestId?: string;
}

/**
 * Thrown when an AIXRouter response (HTTP 200 itself, but the stream or body
 * carries a provider-side error frame, e.g. an SSE `data: {"error":{...}}`
 * payload). Carries enough metadata for the retry logic to decide whether to
 * back off (rate limits) vs. retry (transient empty stream).
 */
export class AIXRouterUpstreamError extends Error {
  readonly code?: string;
  readonly errorType?: string;
  readonly requestId?: string;
  readonly param?: string;
  readonly rateLimited: boolean;

  constructor(prefix: string, payload: UpstreamErrorPayload) {
    super(formatUpstreamMessage(prefix, payload));
    this.name = 'AIXRouterUpstreamError';
    this.code = payload.code;
    this.errorType = payload.type;
    this.requestId = payload.requestId;
    this.param = payload.param;
    this.rateLimited = isRateLimitPayload(payload);
  }
}

/**
 * Try to extract an upstream error from a parsed JSON value. Returns
 * `undefined` if the shape is not a recognised error payload.
 */
export function parseUpstreamErrorPayload(json: unknown): UpstreamErrorPayload | undefined {
  if (!json || typeof json !== 'object') {
    return undefined;
  }
  const obj = json as Record<string, unknown>;
  const err = obj.error;
  if (!err || typeof err !== 'object') {
    return undefined;
  }

  const e = err as Record<string, unknown>;
  const message = stringFrom(e.message);
  const code = stringFrom(e.code);
  const type = stringFrom(e.type);
  const param = stringFrom(e.param);
  const requestId = stringFrom(obj.request_id) ?? stringFrom(e.request_id);

  if (!message && !code && !type) {
    return undefined;
  }

  return { code, message, type, param, requestId };
}

function isRateLimitPayload(payload: UpstreamErrorPayload): boolean {
  const code = payload.code?.toLowerCase();
  const type = payload.type?.toLowerCase();
  if (type === 'rate_limit_error' || type === 'rate_limit') {
    return true;
  }
  if (code === 'limited' || code === 'rate_limited' || code === 'rate_limit_exceeded') {
    return true;
  }
  return false;
}

function formatUpstreamMessage(prefix: string, payload: UpstreamErrorPayload): string {
  const parts: string[] = [];
  if (payload.message) {
    parts.push(payload.message);
  }
  const meta: string[] = [];
  if (payload.code) {
    meta.push(`code=${payload.code}`);
  }
  if (payload.type) {
    meta.push(`type=${payload.type}`);
  }
  if (payload.requestId) {
    meta.push(`request_id=${payload.requestId}`);
  }
  if (meta.length) {
    parts.push(`(${meta.join(' ')})`);
  }
  const detail = parts.join(' ') || 'unknown upstream error';
  return `${prefix}: ${detail}`;
}

export async function createHttpError(prefix: string, response: Response): Promise<Error> {
  const body = await response.text().catch(() => '');
  const details = [
    friendlyStatusMessage(response.status),
    extractErrorDetail(body),
  ].filter(Boolean).join(' ');

  return new AIXRouterHttpError(
    `${prefix}: ${response.status} ${response.statusText}.${details ? ` ${details}` : ''}`,
    response.status,
    response.statusText,
  );
}

export function friendlyStatusMessage(status: number): string | undefined {
  if (status === 400) {
    return 'The request was rejected. Check the selected model and request options.';
  }
  if (status === 401) {
    return 'The API key is missing or invalid. Run "AIXRouter: Set API Key".';
  }
  if (status === 402) {
    return 'The account has insufficient balance or quota.';
  }
  if (status === 403) {
    return 'The API key does not have permission to access this endpoint or model.';
  }
  if (status === 404) {
    return 'The Base URL or model endpoint was not found. Check "AIXRouter: Set Base URL".';
  }
  if (status === 408) {
    return 'The request timed out. Try again or check your network/proxy.';
  }
  if (status === 429) {
    return 'The provider rate limit was reached. Try again later or choose another model.';
  }
  if (status >= 500) {
    return 'The upstream provider returned a server error. Try again later.';
  }
  return undefined;
}

export function extractErrorDetail(body: string): string | undefined {
  if (!body.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown; code?: unknown };
      message?: unknown;
      code?: unknown;
    };
    const message = stringFrom(parsed.error?.message) ?? stringFrom(parsed.message);
    const code = stringFrom(parsed.error?.code) ?? stringFrom(parsed.code);
    if (message && code) {
      return `Provider says: ${message} (${code}).`;
    }
    if (message) {
      return `Provider says: ${message}.`;
    }
  } catch {
    // Fall back to a compact body preview below.
  }

  return `Provider response: ${body.replace(/\s+/g, ' ').slice(0, 500)}.`;
}

export function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function fetchFailedError(endpoint: string, error: unknown, detail?: string): Error {
  const cause = describeError(error);
  const suffix = detail ? ` ${detail}` : '';
  return new Error(`AIXRouter request to ${endpoint} failed before receiving an HTTP response.${suffix} ${cause}`);
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.message];
  const cause = (error as { cause?: unknown }).cause;
  if (cause) {
    parts.push(`Cause: ${describeError(cause)}`);
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && !parts.some((part) => part.includes(code))) {
    parts.push(`Code: ${code}`);
  }

  return parts.join(' ');
}

export function emptyResponseError(source: string, preview: string): Error {
  const normalized = preview.replace(/\s+/g, ' ').trim().slice(0, 800);
  const suffix = normalized ? ` Response preview: ${normalized}` : '';
  return new Error(`AIXRouter ${source} did not contain any assistant text or tool call.${suffix}`);
}
