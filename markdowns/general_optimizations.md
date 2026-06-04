# AMS Access — General Application Optimization Audit

**Date:** 2026-06-01  
**Scope:** Application-wide (Login → Docs → Home → Contest Session)  
**Stack:** Next.js 15 (App Router), React, Tauri v2 (WebKitGTK), Tailwind v4

This document outlines structural, performance, and interaction bottlenecks across the entire application lifecycle, with concrete optimization strategies.

---

## 1. Network & API Layer

### Opt-1: Eliminating Network Waterfalls

Currently, data fetching relies on manual `useEffect` + `fetch` blocks (e.g., in `loadContests`, `checkStatus`, `session/heartbeat`).

- **The Problem:** Components render empty, trigger a fetch, wait, render again. If component A fetches X, and child B fetches Y, you get a waterfall.
- **Optimization:** Migrate to a data-fetching library like **SWR** or **React Query**.
  - Handles request deduplication (prevents 5 rapid clicks on "Refresh" sending 5 requests).
  - Implements stale-while-revalidate (UI feels instant on navigation).
  - Provides automatic retries on failure (crucial for proctoring networks).

### Opt-2: `keepalive` for Critical Beacons

- **The Problem:** The contest `heartbeat`, `log_violation`, and final `submit` endpoints use standard `fetch`. If the user closes the window or navigates away during the request, the browser cancels it.
- **Optimization:** Add `keepalive: true` to all telemetry and submission POST requests. Alternatively, use `navigator.sendBeacon` for violation logs.

### Opt-3: Avoid `await` Chains for Independent API Calls

- **The Problem:** When loading the Home dashboard, checking active sessions, fetching scheduled contests, and verifying the user profile happen sequentially.
- **Optimization:** Use `Promise.all()` to dispatch independent queries concurrently.

---

## 2. React Rendering & State

### Opt-4: Global Timer Overhead

- **The Problem:** Both the Home page and Contest Session have `setInterval(..., 1000)` running to track `now` for countdowns. Every second, the _entire_ component tree from that state downwards re-renders.
- **Optimization:**
  - Isolate time-driven components. Extract `<CountdownBadge endAt={...} />` into its own component with its own internal interval.
  - Use `React.memo` aggressively on list items (e.g., `ScheduledContestCard`) so they only re-render if their specific phase changes, not on every tick of the clock.

### Opt-5: Unmounting and Media Streams (WebRTC)

- **The Problem:** The contest session acquires `getUserMedia` streams. If a user rapidly routes between pages, `useEffect` cleanup functions might race with async stream acquisition.
- **Optimization:** Always use a boolean `cancelled` flag inside the `getUserMedia` promise chain (already partially implemented but needs rigorous enforcement across all media hooks) to ensure streams aren't orphaned and keeping the camera light on.

### Opt-6: React Context Thrashing

- **The Problem:** If global state (like active theme, user profile, active session) is stored in a single large React Context, updating one property (like `theme`) re-renders every component consuming any part of that context.
- **Optimization:** Split Contexts logically (e.g., `ThemeProvider`, `UserProvider`, `SessionProvider`) or use a lightweight global store like **Zustand** which allows atomic selector subscriptions (`const theme = useStore(s => s.theme)`).

---

## 3. Next.js Routing & Bundle Size

### Opt-7: Route Prefetching & Loading States

- **The Problem:** Clicking "PROCEED TO SESSION" calls `router.push('/session/contest')`. The user waits for the JS bundle of the contest area to download and execute before anything paints.
- **Optimization:**
  - Ensure `<Link>` components are used where possible for automatic prefetching.
  - Implement `loading.tsx` in the Next.js App Router for critical routes to show an instant skeleton/spinner while the route chunk loads.

### Opt-8: Dynamic Imports for Heavy Components

- **The Problem:** The contest session loads heavy libraries (like a code editor, WebRTC wrappers, heavy SVGs). These are bundled in the initial page load.
- **Optimization:** Use Next.js `next/dynamic` to lazy-load the editor chunk only when the user actually enters the editor view:
  ```ts
  const CodeEditor = dynamic(() => import("../components/Editor"), { ssr: false });
  ```

---

## 4. Tauri IPC (Inter-Process Communication)

### Opt-9: Batching Security / Process Scans

- **The Problem:** The webview currently queries Tauri for `scan_processes`, `get_platform`, `detect_virtualization`, etc., individually. Each `invoke()` is an IPC round-trip serializing JSON.
- **Optimization:** Create a single Rust command `get_full_telemetry()` that gathers all hardware/OS state in Rust (which is blazingly fast) and returns a single JSON object. Reduces IPC overhead by 80%.

### Opt-10: Debounce Violation Logging

- **The Problem:** If a prohibited app triggers the `scan_processes` interval, the client logs it to the backend immediately. If the app stays open, it might spam logs.
- **Optimization:** The client currently has some deduplication logic (`lastViolationDetailRef`), but it should be formalized. Only send state _transitions_ (e.g., "Violation Started", "Violation Resolved") to the server, rather than continuous ticks.

---

## 5. UI/UX Interaction Polish

### Opt-11: Form Inputs & Submit Buttons

- **The Problem:** Forms (like the Login or Invite Code inputs) allow submission while requests are in-flight, potentially sending duplicate data.
- **Optimization:** Globally enforce that any async `onSubmit` handler disables the submit button and inputs while awaiting the promise.

### Opt-12: Hover States and Layout Shifts

- **The Problem:** Adding borders or bold fonts on hover can cause layout shifts if not accounted for.
- **Optimization:** Use transparent borders by default (e.g., `border: 1px solid transparent`) and colour them on hover, rather than toggling `border: none` to `border: 1px solid`, which moves adjacent elements by 1px.

### Opt-13: CSS Custom Properties vs Inline Styles

- **The Problem:** Heavy use of inline styles (`style={{ ... }}`) requires React to diff large objects on every render and generates bulky DOM output.
- **Optimization:** The app already uses Tailwind v4 via `@theme` in `globals.css`. Migrate inline style values to Tailwind utility classes (`className="flex items-center justify-between p-4 bg-obsidian-base"`) to leverage static CSS, which the browser parses instantly without JS overhead.

---

## 6. Documentation / Static Pages

### Opt-14: Static Site Generation (SSG)

- **The Problem:** If the documentation page fetches markdown or content dynamically on the client, it's slow and bad for SEO.
- **Optimization:** Since docs don't change per-user, use Next.js static rendering (Server Components fetching data at build/revalidate time) so the page is served as pure HTML from the edge CDN.

### Opt-15: Anchor Link Scrolling

- **The Problem:** Clicking an anchor link in docs instantly jumps, losing context.
- **Optimization:** Add `scroll-behavior: smooth;` to the `html` tag in CSS for elegant navigation between documentation headers.

---

## Summary Checklist for the Next Sprint

1. **[ ]** Move interval-driven clocks into isolated leaf components.
2. **[ ]** Replace `fetch` with `SWR` / `React Query` globally.
3. **[ ]** Add `keepalive: true` to all session-critical POSTs.
4. **[ ]** Refactor Tauri `invoke()` calls into batched payloads.
5. **[ ]** Convert inline styles to Tailwind utility classes.
6. **[ ]** Add Next.js `loading.tsx` skeletons for seamless routing.
