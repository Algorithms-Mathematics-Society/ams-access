"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Thrown by fetchJson (and surfaces from raw-fetch call sites that inspect the
 * response) when the backend returns 403 with a session-binding error code —
 * specifically SESSION_DEVICE_MISMATCH or SESSION_IDLE_TIMEOUT.  The candidate
 * should be routed to the resume-request flow rather than shown a hard error.
 *
 * Usage:
 *   catch (err) {
 *     if (err instanceof SessionBindingError) { routeToResume(err.code); return; }
 *   }
 */
export class SessionBindingError extends Error {
  /** One of "SESSION_DEVICE_MISMATCH" | "SESSION_IDLE_TIMEOUT" */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SessionBindingError";
    this.code = code;
  }
}

/** Codes that map to SessionBindingError — backend returns these on 403. */
const SESSION_BINDING_CODES = new Set(["SESSION_DEVICE_MISMATCH", "SESSION_IDLE_TIMEOUT"]);

/**
 * Helper: given a Response object and its parsed body (or null), check whether
 * the backend is signalling a session-binding failure that should redirect the
 * candidate to the resume flow.  Call sites that use raw `fetch` can use this
 * instead of re-implementing the check.
 */
export function checkSessionBindingError(
  res: Response,
  body: { code?: string; error?: string } | null | undefined
): SessionBindingError | null {
  if (res.status === 403 && body?.code && SESSION_BINDING_CODES.has(body.code)) {
    return new SessionBindingError(body.code, body.error ?? body.code);
  }
  return null;
}

type QueryCacheEntry<T> = {
  data?: T;
  error?: Error;
  updatedAt: number;
  promise?: Promise<T>;
};

type FetchJsonOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  dedupeKey?: string;
};

type UseApiQueryOptions = FetchJsonOptions & {
  enabled?: boolean;
  staleMs?: number;
};

const queryCache = new Map<string, QueryCacheEntry<unknown>>();
const queryListeners = new Map<string, Set<() => void>>();

function serializeRequest(input: RequestInfo | URL, init?: RequestInit) {
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : "";
  return `${method}:${String(input)}:${body}`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(task: () => Promise<T>, retries = 2, retryDelayMs = 500): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await delay(retryDelayMs * (attempt + 1));
      }
    }
  }
  throw lastError ?? new Error("Request failed");
}

function notifyQuery(key: string) {
  queryListeners.get(key)?.forEach((listener) => listener());
}

function getCacheEntry<T>(key: string): QueryCacheEntry<T> | undefined {
  return queryCache.get(key) as QueryCacheEntry<T> | undefined;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchJsonOptions = {}
): Promise<T> {
  const {
    timeoutMs = 8000,
    retries = 2,
    retryDelayMs = 500,
    dedupeKey = serializeRequest(input, init),
  } = options;
  const existing = getCacheEntry<T>(dedupeKey)?.promise;
  if (existing) return existing;

  const promise = (async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetchWithTimeout(input, init, timeoutMs);
        if (!response.ok) {
          // Detect session-binding 403s so callers can route to the resume flow.
          if (response.status === 403) {
            let body: { code?: string; error?: string } | null = null;
            try {
              body = (await response.json()) as { code?: string; error?: string };
            } catch {
              // ignore parse failure — fall through to generic error
            }
            const bindingErr = checkSessionBindingError(response, body);
            if (bindingErr) throw bindingErr;
          }
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof SessionBindingError) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          await delay(retryDelayMs * (attempt + 1));
        }
      }
    }
    throw lastError ?? new Error("Request failed");
  })();

  const previous = getCacheEntry<T>(dedupeKey);
  queryCache.set(dedupeKey, {
    data: previous?.data,
    error: previous?.error,
    updatedAt: previous?.updatedAt ?? 0,
    promise,
  });

  try {
    const data = await promise;
    queryCache.set(dedupeKey, { data, updatedAt: Date.now() });
    notifyQuery(dedupeKey);
    return data;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    queryCache.set(dedupeKey, {
      data: previous?.data,
      error: normalized,
      updatedAt: previous?.updatedAt ?? 0,
    });
    notifyQuery(dedupeKey);
    throw normalized;
  }
}

export function useApiQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseApiQueryOptions = {}
) {
  const { enabled = true, staleMs = 30_000, retries = 2, retryDelayMs, timeoutMs } = options;
  const fetcherRef = useRef(fetcher);
  const [snapshot, setSnapshot] = useState<QueryCacheEntry<T> | undefined>(() =>
    key ? getCacheEntry<T>(key) : undefined
  );
  const [isValidating, setIsValidating] = useState(false);

  fetcherRef.current = fetcher;

  const mutate = useCallback(async () => {
    if (!key || !enabled) return undefined;
    setIsValidating(true);
    const previous = getCacheEntry<T>(key);
    const existing = previous?.promise;
    if (existing) {
      try {
        return await existing;
      } finally {
        setIsValidating(false);
      }
    }

    const promise = withRetry(fetcherRef.current, retries, retryDelayMs);
    queryCache.set(key, {
      data: previous?.data,
      error: previous?.error,
      updatedAt: previous?.updatedAt ?? 0,
      promise,
    });
    notifyQuery(key);

    try {
      const data = await promise;
      queryCache.set(key, { data, updatedAt: Date.now() });
      notifyQuery(key);
      return data;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      queryCache.set(key, {
        data: previous?.data,
        error: normalized,
        updatedAt: previous?.updatedAt ?? 0,
      });
      notifyQuery(key);
      throw normalized;
    } finally {
      setIsValidating(false);
    }
  }, [enabled, key, retries, retryDelayMs]);

  useEffect(() => {
    if (!key) {
      setSnapshot(undefined);
      return;
    }

    const listeners = queryListeners.get(key) ?? new Set<() => void>();
    const update = () => setSnapshot(getCacheEntry<T>(key));
    listeners.add(update);
    queryListeners.set(key, listeners);
    update();

    if (enabled) {
      const current = getCacheEntry<T>(key);
      const isStale = !current?.updatedAt || Date.now() - current.updatedAt > staleMs;
      if (isStale) {
        void mutate().catch(() => {});
      }
    }

    return () => {
      listeners.delete(update);
      if (listeners.size === 0) queryListeners.delete(key);
    };
  }, [enabled, key, mutate, staleMs]);

  return {
    data: snapshot?.data,
    error: snapshot?.error,
    isLoading: enabled && !snapshot?.data && (isValidating || Boolean(snapshot?.promise)),
    isValidating,
    mutate,
    revalidate: mutate,
  };
}

export function postJsonKeepalive(url: string, body?: unknown, init: RequestInit = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const keepalive = payload ? payload.length <= 60_000 : true;
  return fetch(url, {
    ...init,
    method: init.method ?? "POST",
    headers: payload ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    body: payload,
    keepalive,
  });
}

export function sendJsonBeacon(url: string, body: unknown) {
  const payload = JSON.stringify(body);
  const target = typeof window !== "undefined" ? new URL(url, window.location.href) : null;
  const isCrossOrigin = target ? target.origin !== window.location.origin : false;

  if (typeof navigator !== "undefined" && navigator.sendBeacon && !isCrossOrigin) {
    return navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
  }

  void postJsonKeepalive(url, body, {
    credentials: "omit",
  }).catch(() => {});
  return false;
}
