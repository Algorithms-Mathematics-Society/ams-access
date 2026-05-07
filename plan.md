# AMS Access — Implementation Plan

Architecture source: `contest-platform-architecture.html`  
Stack: Supabase (Auth + Postgres + Realtime) · AWS (ECS Fargate, EC2 Spot, SQS, S3, CloudFront, ElastiCache) · Go API · Next.js · Tauri exam shell

---

## Repository Layout

```
ams-access/          ← this repo (Tauri exam shell)
contest-platform/    ← separate repo (Go API + judge workers)
contest-web/         ← separate repo (Next.js frontend)
infra/               ← separate repo (Terraform / CDK)
```

> Everything below labeled **[this repo]** lives in `ams-access`. Other repos noted explicitly.

---

## Phase 1 — Working Contest Platform

**Timeline: Months 1–3 · Goal: run real internal contests**

---

### 1.1 Infrastructure Bootstrap

_Branch: `feat/infra-bootstrap` → merge to `main`_

```
feat(infra): create Supabase project and migration runner structure
feat(infra): provision S3 buckets — testcases, submissions, logs, assets
feat(infra): create SQS queues — submission_jobs + DLQ
feat(infra): IAM roles — ECS task role, EC2 judge role, CI deploy role
feat(infra): ECR repositories — go-api, judge-worker
feat(infra): VPC with public subnet (ALB) + two private subnets (app, execution)
feat(infra): ALB + target group + HTTPS listener with ACM cert
feat(infra): ECS cluster (Fargate) with CloudWatch log groups
feat(infra): ElastiCache Redis t3.micro (single node for Phase 1)
feat(infra): CloudFront distribution pointing to S3 static origin
```

**🔖 Checkpoint:** `infra/v0.0.1` — all AWS primitives exist, no app deployed yet

---

### 1.2 Supabase Schema — Migrations

_Branch: `feat/db-schema` → merge to `main`_

```
feat(db): migration 001 — organizations + org_members + RLS skeleton
feat(db): migration 002 — problems + contest_problems
feat(db): migration 003 — contests (status/visibility/scoring_type enum check constraints)
feat(db): migration 004 — submissions (code_s3_key pattern, partial index on pending/judging)
feat(db): migration 005 — leaderboard table + updated_at trigger
feat(db): migration 006 — audit_log table (immutable — no DELETE policy)
feat(db): migration 007 — RLS policies: organizations, org_members, contests
feat(db): migration 008 — RLS policies: problems, submissions, leaderboard
feat(db): migration 009 — seed: platform_admin role bootstrap
```

---

### 1.3 Go API — Core

_Repo: `contest-platform` · Branch: `feat/api-core`_

```
feat(api): project scaffold — Chi router, health check, structured logger (zap)
feat(api): Supabase JWT middleware — RS256 verify via JWKs endpoint at startup
feat(api): RBAC middleware — extract org_id + role from JWT claims
feat(api): orgs — POST /orgs, GET /orgs/:id, PATCH /orgs/:id
feat(api): members — POST /orgs/:id/members (invite), DELETE, PATCH role
feat(api): problems — CRUD endpoints + S3 presigned URL for testcase upload
feat(api): problems — checker type validation (exact/token/custom)
feat(api): problems — approval flow state machine (draft→review→approved)
feat(api): contests — CRUD + lifecycle: draft→review→scheduled→live→frozen→ended
feat(api): contests — attach problems with label + points
feat(api): submissions — POST /submit: validate lang, size-limit 100KB, upload code→S3, enqueue SQS
feat(api): submissions — GET /submissions/:id (contestant own only via RBAC)
feat(api): rate limiter — 1 submission/5s per user per problem (Redis token bucket)
feat(api): audit log — middleware writes admin actions to audit_log table
feat(api): Docker image + ECS task definition + rolling deploy via GitHub Actions
```

---

### 1.4 Judge Worker — Phase 1 (Single EC2, nsjail)

_Repo: `contest-platform` · Branch: `feat/judge-v1`_

```
feat(judge): Go judge worker scaffold — SQS long-poll, graceful SIGTERM handler
feat(judge): SandboxDriver interface — Execute(ctx, ExecRequest) ExecResult
feat(judge): NsjailDriver implementation — spawn nsjail subprocess, parse exit code
feat(judge): compiler support — C++17 (g++), Python 3.11 (pypy fallback), Java 17
feat(judge): checker — exact match
feat(judge): checker — token-based (whitespace-insensitive)
feat(judge): testcase fetcher — download from S3 prefix, cache on disk per problem
feat(judge): verdict writer — PATCH /internal/verdict on Go API (internal-only route)
feat(judge): EC2 AMI build script — nsjail + compilers + judge binary
feat(judge): EC2 launch template — single t3.medium on-demand for Phase 1
feat(judge): submission pipeline integration test — happy path AC, WA, TLE, MLE, RE, CE
```

**🔖 Release: `v0.1.0-alpha`** — internal judge smoke test  
Deploy single judge EC2 + Go API on ECS. Run 50 test submissions manually. Verify verdicts and S3 uploads. No frontend yet.

---

### 1.5 Frontend — Next.js Web

_Repo: `contest-web` · Branch: `feat/web-auth`_

```
feat(web): Next.js 15 App Router scaffold + Tailwind + Supabase client setup
feat(web): auth pages — login (email+password), signup, magic link
feat(web): auth pages — GitHub OAuth callback handler
feat(web): org creation flow + invite member by email
feat(web): problem CMS — Markdown editor (react-md-editor) + KaTeX math preview
feat(web): problem CMS — testcase upload via S3 presigned URL (drag-drop, validate pairs)
feat(web): problem CMS — problem status badge + approval submit button
feat(web): contest management — create/edit contest (scoring type, times, visibility)
feat(web): contest management — attach problems with label + points
feat(web): Monaco Editor — code editor with language selector + submit button
feat(web): submission list — contestant's own submissions, status polling every 3s
feat(web): leaderboard — polling-based (no Realtime yet), full standings table
feat(web): contestant dashboard — registered contests, upcoming, past results
feat(web): admin UI — problem review queue, approve/reject with comment
feat(web): deploy to CloudFront via GitHub Actions (pnpm build → S3 sync → invalidation)
```

**🔖 Release: `v0.2.0-alpha`** — first internal contest  
Run a real 2-hour internal contest with 5–10 people. Collect bugs. Polling leaderboard is acceptable. No Realtime yet.

---

### 1.6 Tauri Exam Shell — Phase 1 Scaffold [this repo]

_Branch: `feat/shell-scaffold`_

> Phase 1 for the Tauri shell is minimal — just ensure the app launches, loads the web UI, and has platform stubs in place for Phase 3. No lockdown logic yet.

```
feat(shell): wire platform-rs into Tauri builder — call platform::init() at startup
feat(shell): add build script (build.rs) for Tauri code generation
feat(shell): Tauri commands — ping, get_platform_info (os + arch)
feat(shell): Linux stub — platform_rs::linux: detect X11 vs Wayland session
feat(shell): Windows stub — platform_rs::windows: detect Windows version, admin rights check
feat(shell): macOS stub — platform_rs::macos: check Screen Recording TCC permission status
feat(shell): core-rs auth stub — session token struct + placeholder verify_session()
feat(shell): web UI — connect @ams/api-client invoke wrappers to Tauri commands
feat(shell): CI matrix builds — Linux AppImage, Windows NSIS+MSI, macOS DMG (no lockdown yet)
```

**🔖 Release: `v0.1.0-shell-alpha`** — installable on all 3 platforms, loads web UI, no lockdown  
Manual test: install on Arch Linux, Windows VM, macOS. Verify app launches. Distribute to 2–3 testers.

---

## Phase 2 — Realtime, Scale, Multi-org

**Timeline: Months 4–7 · Goal: 5k concurrent users, live leaderboard**

---

### 2.1 Supabase Realtime Integration

_Repo: `contest-web` · Branch: `feat/realtime`_

```
feat(realtime): Supabase Realtime client setup — channel factory with JWT auth
feat(realtime): live verdicts — subscribe submissions:${userId}, replace polling
feat(realtime): live leaderboard — subscribe leaderboard:${contestId}, optimistic updates
feat(realtime): clarifications — subscribe contest_announcements:${contestId}
feat(realtime): connection health — auto-reconnect + toast on disconnect
```

### 2.2 Ranking Updater Service

_Repo: `contest-platform` · Branch: `feat/ranking-updater`_

```
feat(ranking): dedicated Go process — subscribe Supabase Realtime submissions channel
feat(ranking): ICPC scoring — update leaderboard row + recompute ranks on AC/WA
feat(ranking): IOI scoring — best attempt per problem, subtask partial credit
feat(ranking): Codeforces scoring — time-decay points formula
feat(ranking): Redis sorted set — ZADD leaderboard:{contest_id} score user_id
feat(ranking): freeze/unfreeze — respect freeze_time, flip is_frozen, post-contest reveal
feat(ranking): ECS service for Ranking Updater (separate task definition)
```

### 2.3 Autoscaling Judge Fleet

_Branch: `feat/judge-autoscaling`_

```
feat(judge): EC2 Auto Scaling Group — c6i.xlarge Spot, mixed instances policy
feat(judge): CloudWatch custom metric — SQS ApproximateNumberOfMessagesVisible / target
feat(judge): ASG scaling policy — step scaling on SQS metric, 3-min cooldown
feat(judge): Spot interruption handler — SIGTERM → stop pulling, finish current job, return SQS visibility
feat(judge): pre-warming Lambda — triggered on contest start_time - 10min, sets ASG desired capacity
feat(judge): drain Lambda — triggered on contest end_time + 30min, scale ASG back to 1
feat(judge): DLQ consumer — alert + log on failed submissions after max receives
```

### 2.4 Go API — Phase 2 Additions

```
feat(api): GET /leaderboard/:contest_id — reads Redis sorted set, falls back to Postgres
feat(api): GET /submissions (admin) — all submissions for a contest, paginated
feat(api): clarifications — POST + GET + broadcast via Supabase Realtime
feat(api): contest scheduler — background goroutine, polls contests every 30s, fires state transitions
feat(api): admin monitor endpoint — queue depth, judge fleet size, error rate (CloudWatch source)
feat(api): Stripe webhooks — subscription plan changes, enforce contest capacity limits per plan
feat(api): org billing endpoints — GET /orgs/:id/billing, POST /orgs/:id/upgrade
```

### 2.5 Frontend — Phase 2

```
feat(web): live verdict component — replace polling with Realtime subscription
feat(web): live leaderboard component — animated rank changes, freeze overlay
feat(web): clarification panel — real-time broadcast + admin post UI
feat(web): billing + plan UI — upgrade flow via Stripe Checkout
feat(web): admin monitor dashboard — queue depth gauge, judge health, submission rate chart
feat(web): IOI + CF scoring display — subtask breakdown table, time-decay score display
```

**🔖 Release: `v0.5.0-beta`** — invite external testers  
Run 2 public beta contests (100–500 participants). Monitor Supabase Realtime connection counts. Validate autoscaling triggers on contest start.

---

### 2.6 Tauri Shell — Platform Lockdown [this repo]

_Branch: `feat/shell-lockdown-linux` then Windows, then macOS (separate PRs)_

#### Linux Lockdown (`packages/platform-rs/src/linux/`)

```
feat(shell/linux): X11 — grab keyboard + pointer via XGrabKeyboard / XGrabPointer
feat(shell/linux): X11 — block Alt+F4, Super, Alt+Tab via XGrabKey on root window
feat(shell/linux): Wayland — detect compositor (sway/KDE/GNOME), send inhibit-shortcuts protocol
feat(shell/linux): detect VMs — check /sys/class/dmi/id/product_name for VMware/VirtualBox/QEMU
feat(shell/linux): process monitor — /proc scan for disallowed apps (discord, obs, etc.) every 5s
feat(shell/linux): network monitor — list active connections via /proc/net/tcp, report to core-rs
feat(shell/linux): screen lock prevention — send DBUS org.freedesktop.ScreenSaver.Inhibit
feat(shell/linux): Tauri commands — lock_desktop, unlock_desktop, get_violation_log
```

#### Windows Lockdown (`packages/platform-rs/src/windows/`)

```
feat(shell/windows): SetWindowsHookEx — low-level keyboard hook, block Win, Alt+Tab, Ctrl+Alt+Del path
feat(shell/windows): RegisterHotKey — suppress system hotkeys during exam
feat(shell/windows): process enumeration — EnumProcesses + check against blocklist every 5s
feat(shell/windows): WMI VM detection — check Win32_ComputerSystem.Manufacturer
feat(shell/windows): registry check — HKLM\SOFTWARE\VMware Inc., VirtualBox keys
feat(shell/windows): SetThreadExecutionState — prevent screen saver + sleep during exam
feat(shell/windows): Tauri commands — lock_desktop, unlock_desktop, get_violation_log
```

#### macOS Lockdown (`packages/platform-rs/src/macos/`)

```
feat(shell/macos): TCC check — Screen Recording permission (required before exam start)
feat(shell/macos): TCC check — Accessibility permission (required for input monitoring)
feat(shell/macos): CGEventTap — capture + suppress Cmd+Tab, Cmd+Space, Cmd+H, Cmd+M
feat(shell/macos): NSWorkspace — enumerate running apps, compare against blocklist every 5s
feat(shell/macos): VM detection — sysctl hw.model, check for Parallels/VMware strings
feat(shell/macos): IOPMAssertionCreateWithName — prevent display sleep during exam
feat(shell/macos): Tauri commands — lock_desktop, unlock_desktop, get_violation_log
```

#### core-rs Exam State Machine

```
feat(shell/core): ExamSession struct — session_token, exam_id, started_at, violations: Vec<Violation>
feat(shell/core): state machine — Idle → Verifying → Active → Suspended → Ended
feat(shell/core): violation types — focus_lost, blocked_app, vm_detected, network_anomaly
feat(shell/core): violation reporter — queue violations, flush to Go API /exam/violations every 30s
feat(shell/core): session heartbeat — POST /exam/heartbeat every 60s (detect connectivity loss)
feat(shell/core): session end — POST /exam/end, unlock desktop, clear state
```

**🔖 Release: `v0.3.0-shell-beta`** — lockdown testing on all platforms  
Test on: Arch Linux (X11 + Wayland), Windows 10/11 VM, macOS (if available). Validate hotkey blocking, VM detection, process scanner.

---

## Phase 3 — Assessment Platform + Advanced

**Timeline: Months 8–18 · Goal: 50k concurrent, enterprise, proctoring**

---

### 3.1 Firecracker Migration

_Branch: `feat/judge-firecracker`_

```
feat(judge): Firecracker VMM integration — jailer + rootfs per language
feat(judge): VM snapshot pool — pre-warm 1 snapshot per language on judge startup
feat(judge): FirecrackerDriver — implement SandboxDriver interface (drop-in for NsjailDriver)
feat(judge): snapshot refresh — rebuild snapshots nightly via cron Lambda
feat(judge): feature flag — SANDBOX_DRIVER=nsjail|firecracker in judge config
```

### 3.2 Assessment Modes

_Repo: `contest-web` + `contest-platform`_

```
feat(assessment): MCQ question type — renderer + answer storage + scoring
feat(assessment): open-ended question type — rich text response, file upload to S3
feat(assessment): hybrid assessment — mix MCQ + coding + open-ended in one session
feat(assessment): AI rubric scoring — async Anthropic API call post-submission, store score + reasoning
feat(assessment): result export — PDF report per participant (Go PDF generation)
```

### 3.3 Proctoring (Async) [this repo + backend]

```
feat(shell/linux): webcam capture — gstreamer pipeline, 1 frame/30s to S3
feat(shell/windows): webcam capture — Windows Media Foundation, 1 frame/30s to S3
feat(shell/macos): webcam capture — AVFoundation, 1 frame/30s to S3
feat(shell/core): event log — structured EventLog (focus_change, app_switch, tab_switch, clipboard)
feat(shell/core): event uploader — batch upload EventLog to S3 on exam end
feat(api): proctoring review UI — admin views event timeline + captured frames per participant
feat(api): tab-switch webhook — Tauri emits focus_lost event → API flags violation
```

### 3.4 Plagiarism Detection

```
feat(api): post-contest plagiarism job — Lambda triggered on contest status→ended
feat(api): MOSS-style token fingerprint — normalize code, rolling hash, similarity matrix
feat(api): similarity report — store suspicious pairs in plagiarism_reports table
feat(web): plagiarism report UI — admin view similarity matrix, flag pairs for review
```

### 3.5 Platform Hardening

```
feat(infra): self-hosted Supabase on EC2 — migrate if >500 concurrent Postgres connections
feat(infra): EKS migration — move Go API + Ranking Updater from ECS to EKS
feat(infra): Kafka MSK — replace SQS for proctoring event pipeline (durability requirement)
feat(infra): multi-region — Route53 latency routing, separate Supabase per region (US + EU)
feat(api): SAML 2.0 SSO — Supabase SAML Enterprise or Okta proxy
feat(api): SOC 2 audit log completeness — immutable logs, access reviews, change management trail
```

### 3.6 Tauri Shell — Phase 3 Polish [this repo]

```
feat(shell): custom checker binary — exam-specific binary distributed with signed update
feat(shell): Tauri updater — auto-update check on launch, signed updates via Tauri signing key
feat(shell): offline resilience — cache exam session locally, sync violations when reconnected
feat(shell): accessibility mode — reduced-lockdown profile for documented accommodations
```

**🔖 Release: `v1.0.0`** — production  
Full contest platform + async proctoring + Firecracker judges.

---

## Release Schedule

| Tag                  | Milestone              | What works                                           | Who tests                                  |
| -------------------- | ---------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `v0.1.0-alpha`       | Judge smoke test       | SQS → judge → verdict, no UI                         | Internal (2 devs)                          |
| `v0.1.0-shell-alpha` | Shell installs         | Tauri app on all 3 platforms, no lockdown            | Internal (3 people)                        |
| `v0.2.0-alpha`       | First contest          | Full submission flow + polling leaderboard + web UI  | Internal (10 people)                       |
| `v0.3.0-shell-beta`  | Shell lockdown         | Platform lockdown on Linux/Windows/macOS             | Internal testers (5 people, all platforms) |
| `v0.5.0-beta`        | Realtime + autoscaling | Live leaderboard, autoscaling judges, Stripe billing | External beta (100–500 users)              |
| `v0.8.0-rc`          | Assessment modes       | MCQ + async proctoring + Firecracker + AI rubric     | Partner orgs                               |
| `v1.0.0`             | Production             | Full stack, SOC 2 in progress, multi-region          | Public                                     |

---

## Branch Strategy

```
main          ← always deployable
releases      ← merge main here when tagging a release
feat/*        ← feature branches, squash-merge to main via PR
hotfix/*      ← emergency fixes, branch from main, merge back immediately
```

CI triggers:

- `feat/*` → lint + typecheck + cargo check + cargo clippy
- `main` → all above + integration tests + build artifacts
- `v*` tags → full release build (all platforms) + draft GitHub release

---

## Commit Conventions

```
feat(scope): add X
fix(scope): correct Y
chore(scope): update Z
feat(shell/linux): ...   ← platform-rs linux module
feat(shell/windows): ... ← platform-rs windows module
feat(shell/macos): ...   ← platform-rs macos module
feat(shell/core): ...    ← core-rs
feat(api): ...           ← Go API (contest-platform repo)
feat(web): ...           ← Next.js (contest-web repo)
feat(db): ...            ← Supabase migration
feat(infra): ...         ← Terraform / CDK
feat(judge): ...         ← judge worker (contest-platform repo)
feat(realtime): ...      ← Supabase Realtime integration
feat(ranking): ...       ← Ranking Updater service
```

---

## Secrets Needed (GitHub + AWS)

| Secret                         | Where used                         |
| ------------------------------ | ---------------------------------- |
| `SUPABASE_URL`                 | API + shell                        |
| `SUPABASE_SERVICE_ROLE_KEY`    | Go API only (never client)         |
| `SUPABASE_ANON_KEY`            | Web + shell                        |
| `AWS_ACCESS_KEY_ID` / `SECRET` | CI deploy only → rotate to OIDC    |
| `TAURI_SIGNING_PRIVATE_KEY`    | Shell release builds               |
| `APPLE_*` (6 secrets)          | macOS notarization                 |
| `STRIPE_SECRET_KEY`            | Go API billing                     |
| `SCCACHE_GHA_ENABLED=true`     | Shell CI (auto via sccache-action) |
