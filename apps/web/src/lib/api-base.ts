// Where the proctor talks to the platform.
//
// The Cloud Run backend this used to point at no longer exists. Everything
// now goes to api.amsaccess.com, which the desktop app reaches with TLS
// pinned to the Let's Encrypt roots — so this host must resolve straight to
// the origin (Cloudflare DNS-only), not through the orange cloud.
const PROD_API_URL = "https://api.amsaccess.com";

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
