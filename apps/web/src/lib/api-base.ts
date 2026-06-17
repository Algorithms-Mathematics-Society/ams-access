const PROD_API_URL = "https://ams-api-test-758052243069.us-central1.run.app";

function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveApiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) return normalize(fromEnv);

  if (typeof window !== "undefined") {
    const host = window.location.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8080";
    }
  }

  return PROD_API_URL;
}
