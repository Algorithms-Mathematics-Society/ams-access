# AMS Access — Low-Latency Order Book Bottleneck Audit

**Date:** 2026-06-01  
**Scenario:** Contestants are given order book / HFT engine problems. Their HTML/CSS/JS solution runs inside the contest area's live preview iframe. Evaluation compares throughput, latency percentiles (p50/p99/p999), and correctness.  
**Stack under audit:** Tauri v2 webview (WebKitGTK on Linux) → Next.js 15 host → `<iframe srcdoc>` preview sandbox → contestant JS code

---

## What "Low Latency" Means Here

An order book matching engine needs to:

- Accept `ADD`, `CANCEL`, `MODIFY` order events at **high throughput** (≥100k msg/s in production HFT)
- Match bids and asks in **O(log n)** or better with price-time priority
- Emit fills / trade confirmations in **microsecond–nanosecond** range
- Maintain a sorted limit order book without allocation spikes

Inside this contest area the realistic target is softer — sub-millisecond event processing at ~10k–50k msg/s — but even that exposes every layer of the current stack as a bottleneck.

---

## Bottleneck Map (Layer → Problem)

```
Contestant Code (JS in iframe)
    │
    ▼
iframe srcdoc sandbox (full document reload on every save)
    │
    ▼
WebKitGTK WebView process (single renderer process, one JS thread)
    │
    ▼
Tauri IPC bridge (async JSON serialization over IPC channel)
    │
    ▼
Next.js host process (React reconciliation, state updates)
    │
    ▼
OS scheduler / Linux kernel (Tauri process, not RT-scheduled)
```

---

## Part 1 — JavaScript Runtime (V8 / JavaScriptCore)

### BN-1 · GC pauses destroy latency percentiles 🔴 Critical

**Category:** CPU / Memory  
**Magnitude:** 1ms – 50ms per major GC pause

JavaScript uses a tracing garbage collector. V8 (Chrome/Node) uses incremental + concurrent GC; WebKitGTK uses JavaScriptCore (JSC) which uses a different concurrent collector. Neither provides real-time guarantees.

An order book that allocates objects per order event (new `Order`, new `PriceLevel`, array spreads, object literals in hot paths) will trigger GC proportional to allocation rate.

**What happens at 10k msg/s:**

- 10,000 × ~120 bytes per order object = ~1.2 MB/s allocation rate
- JSC minor GC fires every ~256KB eden overflow → ~5 pauses/s
- Each minor GC: 0.5–3ms pause → adds ~2.5–15ms to p99 latency
- Major GC (full heap scan): can pause 10–80ms — ruins p999

**Real numbers:** A JSC-based order book processing 10k msg/s will have:

- p50 latency: ~0.05ms (fast path, no GC)
- p99 latency: ~2–5ms (minor GC during measurement window)
- p999 latency: ~20–80ms (major GC)

**Mitigation comparison:**

| Approach                                                                                                | p99 Impact                         | Implementation Cost                                         |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| **A** — Pre-allocate object pools, reuse Order objects                                                  | Eliminates minor GC spikes         | Medium — requires pool discipline in contestant code        |
| **B** — Use TypedArrays for all order data (no object allocation)                                       | Drops allocation rate to near zero | High — contestants must think in fixed-width binary structs |
| **C ✅ Best for contest** — Use `ArrayBuffer` + `DataView` for the hot path; objects only at boundaries | Reduces allocation 80–90%          | Achievable within 4 files of HTML/CSS/JS                    |
| **D** — WebAssembly (WASM) for the matching engine                                                      | Deterministic allocation, no GC    | Requires WASM compilation pipeline in the sandbox           |

**Best approach for this contest area:** Option C. Explain the pattern in the problem statement. Reward contestants who avoid allocation in the matching loop.

---

### BN-2 · Single-threaded execution — no parallelism for market data + matching 🔴 Critical

**Category:** CPU  
**Magnitude:** Serializes all work onto one 1ms-slice OS time quantum

JavaScript is single-threaded. An order book has at least two logically parallel concerns:

1. **Ingestion loop** — parsing market data feed, validating orders
2. **Matching engine** — sorted book maintenance, fill generation
3. **Reporting** — trade blotter, DOM updates, P&L

In JS, all three run on the same thread. If DOM rendering or a React state update interrupts the ingestion loop, messages queue up. At 10k msg/s, the ingestion window is 100µs per message. A single 5ms DOM paint stalls 50 messages.

**Worker thread options:**

| Option                           | What it unlocks                              | Constraint in this sandbox                                               |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `new Worker(...)` in a Blob URL  | Moves matching engine off main thread        | Requires `crossOriginIsolated = true` for `SharedArrayBuffer`            |
| `SharedArrayBuffer`              | True zero-copy shared memory between threads | **Blocked by default** in cross-origin iframes without COOP/COEP headers |
| `MessageChannel` between workers | Message-passing parallelism                  | Serialization overhead ~10–50µs per message — negates the gain           |

**Current iframe setup:** `<iframe srcdoc>` with `sandbox="allow-scripts"` does **not** set `Cross-Origin-Opener-Policy: same-origin` or `Cross-Origin-Embedder-Policy: require-corp`. Therefore `SharedArrayBuffer` is **not available** in contestant code without server-side header changes.

**Best path:** Set `COOP: same-origin` + `COEP: require-corp` headers on the contest page. This unlocks `SharedArrayBuffer` and `Atomics`, allowing a lock-free ring buffer between the ingestion Worker and the matching Worker.

---

### BN-3 · `Date.now()` and `performance.now()` timer resolution is clamped 🟠 High

**Category:** Timing  
**Magnitude:** 1ms resolution floor (up to 100µs in some browsers)

Browsers clamp high-resolution timers as a Spectre mitigation:

- `performance.now()` in cross-origin iframes: **clamped to 1ms** resolution
- `performance.now()` in same-origin context with `crossOriginIsolated = true`: **5µs** resolution
- `Date.now()`: always 1ms

An order book benchmark that measures per-event latency using `performance.now()` inside the current `<iframe srcdoc>` will report quantised 0ms or 1ms for every sub-millisecond event — making latency measurement meaningless.

**Impact on contest judging:** If the contest grades on latency percentiles, every submission will appear identical at the sub-millisecond scale. The benchmark becomes a throughput test at best.

**Mitigation options:**

| Option                                                                                                             | Resolution gained                             | Cost                                                         |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------ |
| **A** — Enable `crossOriginIsolated` via COOP/COEP                                                                 | 5µs resolution in the iframe                  | Server config change + WASM SharedArrayBuffer unblocked      |
| **B** — Use the Tauri native side to do timing via Rust                                                            | Nanosecond resolution                         | Requires IPC round-trip for every measurement (adds latency) |
| **C ✅ Best** — Enable `crossOriginIsolated` (A) + use a batch-timing approach: measure 1000-event windows, divide | Effective µs-level without per-event overhead | Combines accuracy with contest-friendly measurement          |

---

### BN-4 · No SIMD, no 64-bit integers — price arithmetic is slow 🟡 Medium

**Category:** CPU / Arithmetic  
**Magnitude:** 2–10× slower price maths than native

Order books use fixed-point arithmetic for prices (e.g., price in hundredths of a cent to avoid floating-point errors). In JS:

- `Number` is IEEE 754 double — safe integer range is 2^53, enough for prices but floating-point ops are unpredictable
- No native 64-bit integer type (`BigInt` is ~10× slower than `Number`)
- WebAssembly SIMD (`wasm-simd128`) can process 4 × 32-bit prices in one instruction — unavailable in pure JS

**Impact:** Price comparison in the hot path (bid/ask matching) uses floating-point comparison. At 10k msg/s this is ~10M comparisons/s — fast enough, but with jitter from FP pipeline stalls and branch mispredictions that a C++ or Rust engine would not see.

**Best approach:** In the problem statement, require prices as integers (e.g., price in basis points × 100). Avoid `BigInt`. Use `Int32Array` or `Float64Array` for price levels — they access typed memory with no boxing overhead.

---

## Part 2 — The Preview iframe Architecture

### BN-5 · Full srcdoc reload on every code save destroys state 🔴 Critical

**Category:** I/O / Architecture  
**Magnitude:** 100–400ms cold-start per save, resets all order book state

The current preview mechanism (`buildPreview` in `client.tsx`, line 182):

```
setPreviewSrc(buildPreview(newHtml, newCss, newJs));
```

This sets a new `srcdoc` string on the iframe. The iframe **tears down its entire JS context** and rebuilds the document from scratch. For an order book contest:

- All in-memory price levels are gone
- All filled orders are gone
- The simulated market data feed restarts from the beginning
- Any warm-up state (price discovery, spread tightening) is lost

A contestant fixing a bug in the fill algorithm must replay the entire 10k-event test feed every time they save. At 600ms debounce + 300ms iframe cold-start, that's ~900ms of dead time per edit cycle — and the engine restarts with no historical state.

**Mitigation comparison:**

| Option                                                                                                                                      | Preserves state                                          | Implementation complexity         |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| **A** — `contentDocument.write()` via iframe ref instead of srcdoc                                                                          | Partial — avoids navigation, but JS context still resets | Medium                            |
| **B** — `postMessage` hot-reload: inject only changed CSS/JS into running document                                                          | Yes — no document reload for CSS/JS changes              | High                              |
| **C ✅ Best for contest** — Separate the order book engine from the UI. Engine runs as a persistent Worker; only the display layer reloads. | Full — engine state survives saves                       | Medium-high                       |
| **D** — Run order book in Tauri native side (Rust), display results via IPC                                                                 | Full isolation, no GC                                    | High — requires Rust eval harness |

**Best approach:** Option C. The problem statement should require contestants to implement the matching engine in a Web Worker. The host provides a harness that feeds events to the Worker via `MessageChannel`. The Worker never reloads; only the display thread does on save.

---

### BN-6 · `sandbox="allow-scripts"` blocks important performance APIs 🟠 High

**Category:** API availability  
**Magnitude:** Cuts off `performance.mark`, `PerformanceObserver`, `Atomics`

The iframe `sandbox` attribute currently restricts:

- `allow-same-origin` — **not present** (cross-origin sandbox)
- Therefore: no `localStorage`, no `IndexedDB`, no `SharedArrayBuffer`
- `performance.mark()` and `PerformanceObserver` are available but `SharedArrayBuffer`-based lock-free queues are not

Without `allow-same-origin`, a contestant cannot use:

- `SharedArrayBuffer` (ring buffer between workers) — see BN-2
- `Atomics.wait()` / `Atomics.notify()` — spin-lock free queuing
- `performance.now()` at µs resolution — see BN-3

**Best approach:** For the low-latency track, add `allow-same-origin` to the sandbox attribute (accepting the same-origin risk), and serve the contest page with `COOP/COEP` headers. This is the minimum viable configuration for serious performance measurement.

---

### BN-7 · iframe srcdoc has no access to the network — can't simulate realistic market feeds 🟡 Medium

**Category:** I/O  
**Magnitude:** Cannot use WebSocket, EventSource, or XHR from within the sandbox

A real order book receives a market data feed over a network connection (FIX protocol, ITCH, or a WebSocket stream). The current sandbox (`sandbox="allow-scripts"` only) blocks all network access. Contestants must either:

1. Embed the entire test dataset as a JS array literal in their code — unscalable at 10k+ events
2. Receive events via `postMessage` from the host — the current architecture provides no such harness

**Best approach:** The host page posts a structured event stream to the iframe via `postMessage`. The problem harness sends batches of order events at a configurable rate. Contestants implement `onmessage` + `window.dispatchEvent` hooks. This simulates a real market feed without breaking the sandbox.

---

## Part 3 — Tauri / IPC Layer

### BN-8 · Tauri IPC serialises everything through JSON — microsecond killer 🔴 Critical

**Category:** Serialization / I/O  
**Magnitude:** ~10–100µs per round-trip; JSON parse/stringify adds ~5–20µs per message

Every call from the webview to Tauri's Rust backend uses:

```
webview JS → serialize to JSON string → IPC socket → Rust deserializes JSON → invoke handler → serialize result → IPC socket → webview
```

For an order book that needs to log violations, update heartbeat, or report fills to the backend, each IPC call costs:

- JSON serialization: ~5–15µs (for a small order struct)
- IPC socket write + context switch: ~10–30µs
- Rust handler execution: ~1–5µs
- Reverse path: ~15–45µs total

**Total round-trip: 30–95µs per call.** At 10k msg/s this is 300–950ms/s spent purely in IPC overhead — effectively consuming a full CPU core just for serialization.

**Mitigation comparison:**

| Option                                                                                                                                                              | Latency                                 | Bandwidth                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------ |
| **A** — Batch IPC calls (send 100 events at once)                                                                                                                   | Reduces call overhead 100×              | Adds 100-event latency before processing   |
| **B** — Use `ArrayBuffer` transfer via Tauri's `invoke` with binary payloads                                                                                        | ~2× faster than JSON for numeric data   | Requires custom serialization on both ends |
| **C ✅ Best** — Keep all order matching in the webview JS; only send aggregated results to Rust (fills, P&L, violations). IPC is for reporting only, not per-event. | Eliminates hot-path IPC entirely        | Simple architecture separation             |
| **D** — Run matching engine as Tauri plugin in Rust, feed via shared memory                                                                                         | Nanosecond matching, zero serialization | Full rewrite of evaluation harness         |

**Best approach:** Option C for the contest. Order matching stays in the sandbox JS. Tauri/Rust only handles: session heartbeat, violation logging, and final submission. No per-order IPC.

---

### BN-9 · Tauri process is not real-time scheduled — OS can preempt at any time 🟡 Medium

**Category:** OS scheduling  
**Magnitude:** 1–10ms preemption jitter from Linux CFS scheduler

The Tauri app runs under the Linux Completely Fair Scheduler (CFS) at normal priority (`nice 0`). CFS time slices are typically 4–15ms. During a 10k msg/s order book run, the OS can preempt the WebKitGTK renderer process at any point.

Real HFT systems run on:

- SCHED_FIFO or SCHED_RR (real-time scheduler, preemption disabled)
- CPU affinity pinned to isolated cores (`isolcpus`)
- NUMA-aware memory allocation
- Hugepages to eliminate TLB misses

None of these are available in a Tauri webview app.

**Impact on benchmarking:** p999 latency numbers in any benchmark run inside this app will include OS scheduling jitter of 1–10ms that is invisible to the application. Two identical order book implementations can produce different latency measurements purely due to OS scheduler decisions.

**Mitigation:** Accept that sub-millisecond p999 measurements are unreliable in this environment. Grade on p50/p99 with a 1ms minimum granularity. Document this as a known ceiling in the contest problem statement.

---

## Part 4 — Network & WebSocket Stack

### BN-10 · No WebSocket access from within the sandbox iframe 🟠 High

**Category:** I/O / Architecture  
**Magnitude:** Cannot replicate real market data feed ingestion

Real market data arrives via:

- **ITCH 5.0** (NASDAQ) — raw UDP multicast, binary, 50k+ msg/s
- **FIX protocol** — TCP, text-based, ~1k msg/s
- **WebSocket** — browser-accessible but blocked in sandboxed iframe

The current sandbox cannot open a WebSocket. The only feed mechanism is `postMessage` from the host. At high event rates, `postMessage` serialization becomes the bottleneck:

- `postMessage` with a plain object: ~2–5µs per message (structured clone algorithm)
- `postMessage` with `Transferable` (`ArrayBuffer`): ~0.5–1µs per message (zero-copy transfer)
- `postMessage` at 10k msg/s: ~20–50ms/s overhead if using structured clone

**Best approach:** Use `Transferable ArrayBuffers` for the market data feed. The host encodes each order event as a fixed-width binary struct (e.g., 32 bytes: 8 bytes timestamp, 4 bytes order_id, 4 bytes price, 4 bytes qty, 1 byte side, 1 byte type, padding). Transfer ownership — no copy.

---

### BN-11 · Answer save uses HTTP POST per save, no differential compression 🟡 Medium

**Category:** I/O  
**Magnitude:** Each save POSTs the full `{html, css, js}` payload — ~10–50KB per save

The current `handleSave` in `client.tsx` (line 664):

```ts
body: JSON.stringify({ question_id: ..., answer_text: JSON.stringify({ html, css, js }) })
```

For an order book submission, the JS file alone could be 5–20KB. Every save (Ctrl+S) POSTs the entire payload. At 1 save every 10 seconds × 1 hour contest = 360 full uploads. No differential compression, no incremental patch.

**For an HFT problem specifically:** The test harness input data (10k order events) might need to be embedded in the HTML as a JSON array — easily 500KB–2MB of raw data. This would be included in every save payload.

**Best approach:** Store order feed data on the server, referenced by ID. Contestants receive a `feed_id` and call a host API to start the simulation. The submission payload is only the contestant's code, not the feed data.

---

## Part 5 — The Editor Itself

### BN-12 · Raw `<textarea>` has no profiling, no performance overlay 🟠 High

**Category:** Developer Experience / Tooling  
**Magnitude:** Contestants have zero visibility into their engine's performance

An HFT contest without profiling tooling is a guessing game. Currently the contest area provides:

- A `<textarea>` for code
- An iframe preview
- A fake terminal showing `$ make build` / `[HFT_ENGINE] Initializing...`

There is no:

- Throughput counter (messages processed per second)
- Latency histogram (p50/p99/p999 displayed live)
- GC pause indicator
- Memory allocation rate graph
- Order book depth visualizer
- Fill rate chart

A contestant implementing a binary heap vs. a sorted array for price levels has no way to see the performance difference — because there is no performance readout.

**What is needed (not implemented):**

1. A host-provided `window.AMSBenchmark` API that the harness populates
2. An overlay panel (separate from the preview iframe) that displays:
   - Live throughput (events/s, rolling 1s window)
   - Latency histogram updated every 500ms
   - Memory usage (via `performance.memory` where available)
   - GC event markers (via `PerformanceObserver` observing `gc` entries)

---

### BN-13 · `tabSize: 4` in textarea vs. 2-space JS community norm — minor but real 🔵 Low

The textarea has `tabSize: 4`. Most JS developers use 2-space indent. For dense data-structure code (order book nodes, price level maps), 4-space indent quickly pushes lines past 80–100 characters, forcing horizontal scrolling in the narrow editor pane. Minor but adds friction for a time-pressured contest.

---

## Part 6 — Memory Architecture

### BN-14 · No heap size control — JSC defaults to ~1.4GB cap 🟡 Medium

**Category:** Memory  
**Magnitude:** Order book with 10 price levels × 100k orders = potential 100MB+ heap

JavaScriptCore's default heap limit in WebKitGTK is not easily controllable from userland. A poorly written order book that accumulates all historical orders in memory (instead of evicting cancelled/filled ones) will grow the heap unboundedly.

At ~200 bytes per Order object × 100k orders = ~20MB. This is fine. But if the contestant stores order history, event logs, tick-by-tick snapshots: easily 200–500MB. JSC will GC aggressively at high usage, adding multi-hundred-millisecond pauses.

**Best approach:** The problem statement must specify memory constraints explicitly: "Your matching engine must operate within a 32MB heap budget. Orders that are fully filled or cancelled must be released." Enforce this via `performance.memory.usedJSHeapSize` checks in the harness.

---

### BN-15 · No `malloc`/`free` control — cannot use memory pools 🔴 Critical (for serious HFT)

**Category:** Memory  
**Magnitude:** All allocation goes through JSC's allocator — no slab allocators, no arena allocation

Real HFT order books use:

- **Slab allocators** — pre-allocated pools of fixed-size Order structs, reused after cancellation
- **Lock-free ring buffers** — SPSC queue between ingestion thread and matching thread
- **Hugepages** — 2MB pages to eliminate TLB misses in the order book array

None of these exist in JavaScript. The only approximation is:

- **Object pools** — manually maintain a free list of Order objects, reset fields on reuse
- **TypedArray rings** — `SharedArrayBuffer` + `Int32Array` as a ring buffer (requires `crossOriginIsolated`)
- **WASM linear memory** — `WebAssembly.Memory` with explicit `malloc`/`free` in a custom allocator

**Impact on max achievable throughput:**

| Approach                          | Max sustained throughput (estimate) | GC pressure           |
| --------------------------------- | ----------------------------------- | --------------------- |
| Plain JS objects, no pooling      | ~5k–20k msg/s before GC saturation  | High                  |
| Object pooling (manual free list) | ~50k–100k msg/s                     | Low                   |
| TypedArray ring + no object alloc | ~200k–500k msg/s                    | Near-zero             |
| WASM matching engine              | ~1M+ msg/s                          | Zero (WASM has no GC) |

**Takeaway:** A TypedArray-based implementation is 10–25× faster than naive object allocation. The contest should explicitly teach and reward this pattern.

---

## Latency Budget Breakdown (Realistic, 10k msg/s)

| Layer                                           | Best Case         | Worst Case (p999) | Culprit                             |
| ----------------------------------------------- | ----------------- | ----------------- | ----------------------------------- |
| JS hot-path matching (sorted array, no alloc)   | 2–5µs             | 10µs              | Branch misprediction                |
| JS hot-path matching (object alloc)             | 5–20µs            | 50µs              | Allocation + inline cache misses    |
| Minor GC pause                                  | 0 (no GC window)  | 2–5ms             | JSC eden overflow                   |
| Major GC pause                                  | 0                 | 20–80ms           | Full heap scan                      |
| `performance.now()` timer clamping              | 1ms (floored)     | 1ms               | Browser security policy             |
| `postMessage` event delivery (structured clone) | 2µs               | 200µs             | Structured clone for large payloads |
| iframe srcdoc reload (per save)                 | 100ms             | 400ms             | Full document re-parse              |
| Tauri IPC round-trip (if used)                  | 30µs              | 100µs             | JSON serialization + socket         |
| OS scheduler jitter (CFS)                       | 0 (no preemption) | 5–15ms            | Linux CFS time slice                |

---

## Summary — Bottleneck Impact Matrix

| ID    | Bottleneck                               | Layer          | Severity    | Fixable Without Rewrite?                          |
| ----- | ---------------------------------------- | -------------- | ----------- | ------------------------------------------------- |
| BN-1  | GC pauses destroy p99/p999               | JS Runtime     | 🔴 Critical | Partially — requires pool discipline              |
| BN-2  | Single-threaded, no parallelism          | JS Runtime     | 🔴 Critical | Yes — enable SharedArrayBuffer + Workers          |
| BN-3  | `performance.now()` clamped to 1ms       | Browser API    | 🔴 Critical | Yes — COOP/COEP headers                           |
| BN-4  | No SIMD, no int64                        | JS Runtime     | 🟡 Medium   | No — inherent JS limitation                       |
| BN-5  | Full iframe reload on save resets engine | Architecture   | 🔴 Critical | Yes — Worker-based engine separation              |
| BN-6  | Sandbox blocks SharedArrayBuffer         | iframe sandbox | 🟠 High     | Yes — add `allow-same-origin` + COOP/COEP         |
| BN-7  | No network access for live feeds         | iframe sandbox | 🟡 Medium   | Yes — postMessage harness                         |
| BN-8  | Tauri IPC is JSON, ~100µs/round-trip     | IPC            | 🔴 Critical | Yes — keep matching in JS, IPC for reporting only |
| BN-9  | OS CFS scheduler jitter                  | OS             | 🟡 Medium   | No — inherent non-RT OS limitation                |
| BN-10 | No WebSocket in sandbox                  | iframe sandbox | 🟠 High     | Yes — postMessage feed harness                    |
| BN-11 | Full payload on every answer save        | Network        | 🟡 Medium   | Yes — server-side feed storage                    |
| BN-12 | No profiling/benchmark overlay           | Tooling        | 🟠 High     | Yes — host-provided `window.AMSBenchmark` API     |
| BN-13 | Tab size mismatch                        | Editor         | 🔵 Low      | Yes — one CSS property                            |
| BN-14 | No heap size control                     | Memory         | 🟡 Medium   | Partially — problem statement constraints         |
| BN-15 | No slab allocator / arena allocation     | Memory         | 🔴 Critical | Partially — TypedArray pools, WASM                |

---

## The Fundamental Ceiling

Even after fixing every addressable bottleneck above, the hard ceilings of this platform are:

| Ceiling                          | Value                                     | Cause                              |
| -------------------------------- | ----------------------------------------- | ---------------------------------- |
| **Max timer resolution**         | 5µs (with COOP/COEP), 1ms without         | Browser Spectre mitigations        |
| **Max single-thread throughput** | ~500k msg/s (TypedArray engine, no alloc) | JSC JIT limits                     |
| **Max parallelism**              | 4–8 Workers (core count dependent)        | No shared memory without COOP/COEP |
| **Min GC pause**                 | 0.1–0.5ms (with aggressive pooling)       | JSC collector cannot be disabled   |
| **Min IPC latency**              | ~10µs (binary Tauri payloads)             | OS socket + context switch         |
| **OS scheduler jitter**          | ±5ms p999                                 | Linux CFS, non-RT priority         |

**Realistic contest target:** p50 < 100µs, p99 < 1ms, p999 < 10ms — achievable with TypedArray pools + Worker separation + COOP/COEP headers. Anything beyond this requires WASM or a native Tauri plugin.

**Production HFT target for comparison:** p50 < 1µs, p99 < 10µs, p999 < 100µs — requires C++/Rust, DPDK, kernel bypass, FPGA. Not achievable in any browser-based environment.

---

## Recommended Architecture for a Low-Latency Contest Track

```
Host Page (Next.js, COOP/COEP enabled)
│
├── Problem Statement pane
├── Code Editor (CodeMirror 6, HTML/CSS/JS)
├── Benchmark Overlay (live throughput + latency histogram)
│
└── Preview iframe (sandbox="allow-scripts allow-same-origin", COEP)
    │
    ├── Main thread: DOM display + chart rendering only
    │
    └── Worker thread: Order Book Matching Engine
        │  (SharedArrayBuffer ring buffer)
        ├── Ingestion Worker: receives events from host via Transferable ArrayBuffer
        └── Matching Worker: price-level sorted structure, fill generation
              │
              └── postMessage aggregated results back to main thread (fills, P&L)
```

This architecture isolates GC pressure to the display thread, gives the matching engine a dedicated Worker with near-real-time priority, and uses zero-copy Transferable buffers for the hot path. It is the maximum achievable within a browser-based contest environment.
