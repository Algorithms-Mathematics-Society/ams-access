# AMS Access — development setup

The proctor desktop app (`~/ams-access`). Tauri 2 + Next.js in a pnpm
workspace. Linux, macOS and Windows.

---

## 1. The one thing to understand first

`pnpm dev` opens the desktop app pointing at **`http://localhost:8080`**, not
production.

The app picks its API by the port it is served from: port 3000 (the Next dev
server, which `tauri dev` starts) means development, anything else means
`https://api.amsaccess.com`. There is **no environment variable for this** and
adding one will not work — `resolveApiBase()` deliberately ignores
`NEXT_PUBLIC_API_URL`, because a stale repo secret once silently overrode it
and shipped a dead API host in v2.0.0.

So pick one:

| You want                              | Run                                                        |
| ------------------------------------- | ---------------------------------------------------------- |
| **The hosted API — the usual choice** | `pnpm dev:hosted`                                          |
| Browser only, fastest for UI work     | `cd apps/web && pnpm dev:hosted` → <http://localhost:3001> |
| The whole stack locally               | `pnpm dev` + `ams-api` on :8080 (section 5)                |

`dev:hosted` simply serves on port 3001 instead of 3000, which is the entire
mechanism. No backend, no database, no env file — it talks to
`https://api.amsaccess.com` with real data. Sign in with a participant login.

---

## 2. Prerequisites

Same for every OS:

- **Node ≥ 22.6** (CI uses 24)
- **pnpm 10.30.3** — `corepack enable && corepack prepare pnpm@10.30.3 --activate`
- **Rust stable** — https://rustup.rs

Then the platform bits.

### Linux (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  librsvg2-dev \
  patchelf \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev
```

That list is copied from CI, so it is the one that is actually known to work.
**Without `libwebkit2gtk-4.1-dev` the desktop crate will not compile** — the
Next app still runs, so Path A above works on a box that cannot build the
shell at all.

Fedora: `gtk3-devel webkit2gtk4.1-devel librsvg2-devel patchelf libxdo-devel openssl-devel libappindicator-gtk3-devel`
Arch: `gtk3 webkit2gtk-4.1 librsvg patchelf xdotool openssl libayatana-appindicator`

### macOS

```bash
xcode-select --install
```

That is all. WebKit ships with the OS.

### Windows

1. **Visual Studio Build Tools** with the _Desktop development with C++_
   workload — https://visualstudio.microsoft.com/visual-cpp-build-tools/
   (Rust needs the MSVC linker; this is the usual first failure.)
2. **WebView2 runtime** — preinstalled on Windows 11 and current Windows 10.
   If missing: https://developer.microsoft.com/microsoft-edge/webview2/

Use PowerShell, not Git Bash, for the commands below.

---

## 3. Get it running

```bash
git clone https://github.com/Algorithms-Mathematics-Society/ams-access.git
cd ams-access
pnpm install
```

Then, from the repo root:

```bash
pnpm dev
```

This runs `tauri dev`, which first builds the bundled network helper and
starts the Next dev server on :3000, then opens the desktop window. **First
run compiles the whole Rust dependency tree — expect 5–15 minutes.** Later
runs are seconds.

Sign in with a participant login (ask Ayush for one).

---

## 4. The flag you will want

```bash
NEXT_PUBLIC_AMS_RELAX_GATING=1 pnpm dev
```

Without it, onboarding blocks on the network-helper check, which needs a real
install that a dev machine does not have — so you never reach the contest
room.

It only relaxes **network** inputs, logs every relaxation, and shows a visible
"relaxed mode" badge. VM detection, camera and restricted-app checks still
block. It is read at build time only, so a shipped build cannot have it
switched on at runtime.

---

## 5. Optional: the backend on :8080

Only needed for Path B. In `~/ams-api`:

```bash
# Postgres with role ams / password ams, database ams
uv run alembic upgrade head
uv run uvicorn ams_api.main:app --port 8080 --reload
```

**No `.env` is required** — every setting has a working default
(`postgresql+psycopg://ams:ams@localhost:5432/ams`, and a dev-only internal
secret).

**Do not use the production `.env`.** `AMS_INTERNAL_API_SECRET` plus an
`X-Auth-Subject` header lets the holder act as any user in the system, and
`AMS_DATABASE_URL` points at production Postgres.

Known limit: with no SQS queue configured, `enqueue_submission` silently does
nothing. Submissions are created and stay `QUEUED` for ever — nothing is
judged. That is expected locally, not a bug.

For the portal (`~/amsaccess`), set `AMS_DEV_SUBJECT` to a seeded user's
subject to skip Cognito entirely in non-production builds.

---

## 6. Everyday commands

Run from the repo root.

|                       |                                                            |
| --------------------- | ---------------------------------------------------------- |
| `pnpm dev:hosted`     | desktop app against the **hosted** API — no backend needed |
| `pnpm dev`            | desktop app against a **local** API on :8080               |
| `pnpm test`           | all guard tests                                            |
| `pnpm typecheck`      | TypeScript across the workspace                            |
| `pnpm lint`           | lint                                                       |
| `pnpm build`          | production bundle for your OS                              |
| `pnpm check:versions` | manifests agree on one version (CI enforces)               |

Rust, from the root:

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --check
```

---

## 7. When it goes wrong

| Symptom                                        | Cause                                                                                                                                                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webkit2gtk` not found (Linux)                 | missing system deps — section 2                                                                                                                                                                                              |
| `link.exe not found` (Windows)                 | VS Build Tools without the C++ workload                                                                                                                                                                                      |
| "Cannot reach the exam server"                 | nothing on :8080; use `--port 3001` for Path A                                                                                                                                                                               |
| Stuck on the network check in onboarding       | set `NEXT_PUBLIC_AMS_RELAX_GATING=1`                                                                                                                                                                                         |
| First build seems hung                         | it is compiling Rust; give it 15 minutes                                                                                                                                                                                     |
| `Can't resolve '@astryxdesign/core/reset.css'` | **Run `pnpm install`.** It is declared but missing from `node_modules` after a pull. The failure reads as a CSS syntax error, not a missing package, which is why it wastes time. Same in `~/amsaccess`, with `npm install`. |
| Anything odd right after `git pull`            | `pnpm install` — dependencies move with the code                                                                                                                                                                             |

**There is no `.env` file in this repo and none is needed.** If a guide
anywhere tells you to create one, it is out of date.
