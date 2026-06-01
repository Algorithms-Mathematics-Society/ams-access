# AMS Access - Unified Low-Latency Contest Runtime Plan

Date: 2026-06-01  
Status: Planned  
Scope: Current contest area only. No separate low-latency mode.

## Principle

The existing contest runtime should be optimized so it can support order-book / HFT-style problems when needed.

Low-latency behavior should come from the runtime architecture:

- binary batched input
- transferable buffers
- worker-friendly execution
- minimal allocation pressure
- throttled UI reporting
- no per-event React updates
- no hot-path Tauri IPC

The normal HTML/CSS/JS contest experience must continue to work.

---

## Success Criteria

- Contestant code can process synthetic order-book event batches without full iframe reload during execution.
- Market events are delivered as transferable `ArrayBuffer` batches, not per-event JSON objects.
- React state updates are limited to coarse benchmark summaries, no more than 4 times per second.
- The preview iframe exposes a small benchmark/feed API before contestant JS runs.
- p50, p99, p999, throughput, processed count, and error count are visible in the current contest UI.
- The runtime detects available browser capabilities such as `Worker`, `SharedArrayBuffer`, `crossOriginIsolated`, and high-resolution timers.
- Existing simple HTML/CSS/JS preview behavior remains intact.

---

## Step 1 - Add Runtime Capability Detection

Status: [ ]

Goal: detect what the current WebView/browser can safely support.

Implement capability detection inside the preview harness for:

- `Worker`
- `SharedArrayBuffer`
- `crossOriginIsolated`
- `performance.now`
- transferable `ArrayBuffer`
- iframe sandbox limitations

Expose these capabilities to contestant code through a small global object, for example:

```ts
window.AMSRuntime.capabilities
```

Acceptance criteria:

- The contest UI can show whether low-latency features are available.
- Missing capabilities do not break normal preview execution.
- Shared memory is used only when actually available.

Related bottlenecks:

- BN-2
- BN-3
- BN-6
- BN-9

---

## Step 2 - Add Preview Benchmark Harness

Status: [ ]

Goal: inject a small runtime harness into `buildPreview` before contestant JavaScript.

The harness should provide a stable global API such as:

```ts
window.AMSBenchmark
window.AMSMarketData
window.AMSRuntime
```

Minimum behavior:

- start benchmark
- stop benchmark
- receive event batches
- record processed event count
- record latency samples
- report aggregated metrics to the host with `postMessage`

The harness must not require contestants to use React, Tauri APIs, or DOM events in the matching hot path.

Acceptance criteria:

- Contestant JS can subscribe to binary event batches.
- Host receives benchmark summaries.
- Existing HTML/CSS/JS preview still works if the benchmark API is unused.

Related bottlenecks:

- BN-1
- BN-5
- BN-8
- BN-12

---

## Step 3 - Use Transferable Binary Event Batches

Status: [ ]

Goal: replace per-event JSON-style feeds with deterministic binary batches.

Use `ArrayBuffer` plus `DataView` or typed arrays for synthetic order events.

Recommended record shape:

- event type
- order id
- side
- price as integer ticks
- quantity
- timestamp or sequence number

Batches should be transferred with:

```ts
iframe.contentWindow.postMessage(message, "*", [buffer])
```

Acceptance criteria:

- Event feed uses transferable buffers.
- No object is allocated per order event by the host feed.
- Feed generation is deterministic for repeatable scoring.
- Batch size is configurable, with a sensible default such as 1,000 events per batch.

Related bottlenecks:

- BN-1
- BN-4
- BN-7
- BN-10
- BN-11
- BN-14

---

## Step 4 - Add Throttled Benchmark Overlay

Status: [ ]

Goal: show benchmark results in the existing contest UI without creating a new mode.

Display:

- events processed
- events per second
- p50 latency
- p99 latency
- p999 latency
- errors
- runtime capability status

UI updates should be throttled to approximately 250ms to 500ms.

Acceptance criteria:

- Metrics update smoothly without per-event React reconciliation.
- The overlay does not block normal preview use.
- Errors from contestant benchmark code are visible but do not crash the host page.

Related bottlenecks:

- BN-8
- BN-12

---

## Step 5 - Make Contestant Starter Code Allocation-Aware

Status: [ ]

Goal: guide contestants toward low-allocation implementations without enforcing a separate mode.

Update the relevant order-book starter/problem template to demonstrate:

- `ArrayBuffer`
- `DataView`
- integer price ticks
- preallocated arrays
- no object creation in the matching loop
- optional Worker handoff when supported

Also set editor defaults for these problems to use 2-space indentation.

Acceptance criteria:

- Starter code demonstrates the intended hot-path pattern.
- Problem statement explains why object allocation hurts p99/p999 latency.
- Existing non-order-book problems are unaffected.

Related bottlenecks:

- BN-1
- BN-4
- BN-13
- BN-14
- BN-15

---

## Step 6 - Keep Hot Path Away From Tauri IPC And React

Status: [ ]

Goal: ensure benchmark execution does not depend on host state updates or native IPC.

Rules:

- Do not send every event through Tauri commands.
- Do not store per-event data in React state.
- Do not serialize hot-path messages as JSON.
- Only aggregate summaries should cross back to the host UI.
- Saves should continue storing contestant source code, not generated feed data.

Acceptance criteria:

- Benchmark can run with no Tauri IPC in the event loop.
- Host receives only coarse summaries.
- Save payload remains focused on contestant code.

Related bottlenecks:

- BN-5
- BN-8
- BN-11

---

## Step 7 - Security And Isolation Review

Status: [ ]

Goal: improve performance where possible without silently weakening iframe isolation.

Default behavior:

- Keep the existing sandbox conservative unless a specific feature requires more.
- Prefer runtime detection over assuming `SharedArrayBuffer` is available.
- Add COOP/COEP headers only where the deployment model supports them.
- Document that static Tauri export may not get the same header behavior as dev/server mode.

Acceptance criteria:

- Normal preview sandbox behavior remains safe.
- Capability status explains why advanced paths are unavailable.
- Any sandbox relaxation is explicit and reviewed.

Related bottlenecks:

- BN-2
- BN-3
- BN-6

---

## Step 8 - Verification

Status: [ ]

Run verification after implementation.

Required checks:

- TypeScript check
- production build
- normal HTML/CSS/JS preview smoke test
- benchmark harness smoke test
- 10k events synthetic feed
- 50k events synthetic feed
- contestant error handling test
- iframe reload behavior test
- save/restore regression test

Acceptance criteria:

- Existing contest behavior still works.
- Benchmark metrics appear in the current contest UI.
- No per-event React state updates are introduced.
- No hot-path Tauri IPC is introduced.
- Latency summaries are stable enough for comparative scoring.

---

## Bottleneck Coverage Map

| Bottleneck | Covered By |
| --- | --- |
| BN-1 GC pauses | Steps 3, 5 |
| BN-2 single JS thread | Steps 1, 5, 7 |
| BN-3 timer clamping | Steps 1, 7 |
| BN-4 JS number/object overhead | Steps 3, 5 |
| BN-5 iframe reload | Steps 2, 6 |
| BN-6 sandbox limitations | Steps 1, 7 |
| BN-7 no feed ingress | Step 3 |
| BN-8 Tauri IPC JSON | Steps 4, 6 |
| BN-9 OS scheduler jitter | Steps 1, 7 |
| BN-10 WebSocket mismatch | Step 3 |
| BN-11 full save payload | Step 6 |
| BN-12 no benchmark overlay | Step 4 |
| BN-13 editor tab size | Step 5 |
| BN-14 heap constraints | Steps 3, 5 |
| BN-15 no slab allocator | Step 5 |

---

## Notes

This plan intentionally avoids creating a separate low-latency mode.

The current contest area becomes capable of running low-latency challenges through an injected runtime harness and benchmark feed. For ordinary frontend challenges, the harness should remain passive and invisible unless used.
