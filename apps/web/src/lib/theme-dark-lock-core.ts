// Pure route-dark-lock resolution — NO DOM, NO React, NO imports. Node-testable.
// PARITY: buildDarkLockBody() and isRouteDarkLocked() MUST encode the SAME rule (parity test).
export const DARK_LOCKED_ROUTES = ["/home", "/session/onboarding", "/session/contest"] as const;

/** Strip a trailing "/index.html", then a single trailing "/". Root "/" preserved. */
export function normalizePath(pathname: string): string {
  let p = pathname || "/";
  p = p.replace(/\/index\.html$/, "");
  if (p.length > 1) p = p.replace(/\/$/, "");
  return p === "" ? "/" : p;
}

/** True iff the normalized path IS a locked route or nested under one. */
export function isRouteDarkLocked(
  pathname: string,
  routes: readonly string[] = DARK_LOCKED_ROUTES
): boolean {
  const p = normalizePath(pathname);
  return routes.some((r) => {
    const nr = normalizePath(r);
    return p === nr || p.startsWith(nr + "/");
  });
}

/**
 * Body of the pre-paint dark-lock fragment (no IIFE wrapper; theme.ts folds it into the init IIFE).
 * References document/location. Fail-CLOSED: on any error, ADD the lock.
 */
export function buildDarkLockBody(routes: readonly string[]): string {
  const R = JSON.stringify(routes.map(normalizePath));
  return (
    `try{` +
    `var R=${R},p=location.pathname.replace(/\\/index\\.html$/,'');` +
    `if(p.length>1)p=p.replace(/\\/$/,'');if(p==='')p='/';` +
    `for(var i=0;i<R.length;i++){if(p===R[i]||p.indexOf(R[i]+'/')===0){` +
    `document.documentElement.classList.add('theme-dark-locked');break;}}` +
    `}catch(e){document.documentElement.classList.add('theme-dark-locked');}`
  );
}
