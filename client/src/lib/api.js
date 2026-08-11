/**
 * Thin fetch wrapper. Always sends the session cookie and turns non-2xx
 * responses into thrown Errors carrying the server's message.
 */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * How many times to re-attempt a request that never got a response.
 *
 * GETs are safe to repeat by definition. Writes are not, so they only retry
 * when the caller opts in — which they should do only for endpoints carrying
 * an idempotency key (run and submit), never for ones that append to a log
 * like the heartbeat, where a repeat would count a violation twice.
 */
const DEFAULT_RETRIES = { GET: 2 };

async function request(method, path, body, options = {}) {
  const { retry, ...fetchOptions } = options;
  const attempts = (retry ?? DEFAULT_RETRIES[method] ?? 0) + 1;

  const init = {
    method,
    credentials: 'include',
    headers: {},
    ...fetchOptions,
  };

  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  for (let i = 0; ; i += 1) {
    try {
      res = await fetch(`/api${path}`, init);
      break;
    } catch {
      // A whole hall connecting at once will drop the odd socket. The student
      // must not lose an answer to that, so back off briefly and try again.
      if (i + 1 >= attempts) {
        throw new ApiError(0, 'Cannot reach the server — check your connection');
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1) + Math.random() * 300));
    }
  }

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const message = (isJson && payload?.error) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, isJson ? payload?.details : undefined);
  }
  return payload;
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body, options),
  patch: (path, body, options) => request('PATCH', path, body, options),
  put: (path, body, options) => request('PUT', path, body, options),
  del: (path, options) => request('DELETE', path, undefined, options),
};
