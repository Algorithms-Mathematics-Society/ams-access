/** This build's version, sent as `X-AMS-Client-Version` on every API call.
 * The server's 426 gate lets a request with no header through, so a call
 * that omits it slips past the minimum-version check. Same source as
 * proctor-api.ts's `CLIENT_VERSION`. */
export const CLIENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "2.0.0";
