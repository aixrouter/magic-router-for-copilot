const FETCH_TIMEOUT_MS = 60000;
const FETCH_RETRIES = 1;

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      return await fetchWithTimeout(url, init, signal);
    } catch (error) {
      if (signal?.aborted || attempt >= FETCH_RETRIES) {
        throw error;
      }
    }
  }

  throw new Error('Request failed.');
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Fetches a URL and reads the response body as JSON within the timeout window.
 * Creates its own AbortController whose signal is passed directly to fetch()
 * so the timeout covers both the HTTP request and the body read.
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw await httpError(url, response);
      }
      const body = (await response.json()) as T;
      if (timedOut) {
        throw new Error(`Request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms.`);
      }
      return body;
    } catch (error) {
      if (timedOut || signal?.aborted || attempt >= FETCH_RETRIES) {
        if (timedOut) {
          throw new Error(`Request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms.`);
        }
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  throw new Error('Request failed.');
}

/**
 * Fetches a URL and reads the response body as text within the timeout window.
 * Creates its own AbortController whose signal is passed directly to fetch()
 * so the timeout covers both the HTTP request and the body read.
 */
export async function fetchTextWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<string> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw await httpError(url, response);
      }
      const body = await response.text();
      if (timedOut) {
        throw new Error(`Request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms.`);
      }
      return body;
    } catch (error) {
      if (timedOut || signal?.aborted || attempt >= FETCH_RETRIES) {
        if (timedOut) {
          throw new Error(`Request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms.`);
        }
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  throw new Error('Request failed.');
}

async function httpError(url: string, response: Response): Promise<Error> {
  const body = await response.text().catch(() => '');
  const preview = body.replace(/\s+/g, ' ').trim().slice(0, 500);
  const suffix = preview ? ` Response: ${preview}` : '';
  return new Error(`Request to ${url} failed: ${response.status} ${response.statusText}.${suffix}`);
}
