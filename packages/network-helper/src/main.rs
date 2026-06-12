//! AMS Access privileged network helper.
//!
//! The real implementation lives in `helper.rs` and is Unix-only: it binds a
//! Unix domain socket and drives pfctl, neither of which exists on Windows.
//! Windows network lockdown is enforced by the main app (WFP), but this crate
//! must still compile there because CI builds the whole workspace on every
//! shipping platform and the bundler expects a helper artifact. On non-Unix
//! the binary is a stub that refuses to run.

#[cfg(unix)]
mod helper;

#[cfg(unix)]
fn main() {
    helper::run();
}

#[cfg(not(unix))]
fn main() {
    eprintln!("ams-access-networkhelper is only supported on Unix platforms");
    std::process::exit(1);
}
