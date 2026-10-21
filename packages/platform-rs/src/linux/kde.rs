use crate::process_runner::CommandDeadlineExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

const KREADCONFIG: &[&str] = &[
    "kreadconfig6",
    "/usr/bin/kreadconfig6",
    "kreadconfig5",
    "/usr/bin/kreadconfig5",
];
const KWRITECONFIG: &[&str] = &[
    "kwriteconfig6",
    "/usr/bin/kwriteconfig6",
    "kwriteconfig5",
    "/usr/bin/kwriteconfig5",
];
const QDBUS: &[&str] = &[
    "qdbus6",
    "qdbus-qt6",
    "/usr/lib/qt6/bin/qdbus",
    "qdbus",
    "qdbus-qt5",
    "/usr/lib/qt5/bin/qdbus",
];

static READ_TOOL: OnceLock<&'static str> = OnceLock::new();
static WRITE_TOOL: OnceLock<&'static str> = OnceLock::new();
static DBUS_TOOL: OnceLock<&'static str> = OnceLock::new();

fn discover_with(
    candidates: &'static [&'static str],
    mut exists: impl FnMut(&str) -> bool,
    mut probe: impl FnMut(&str) -> bool,
) -> Option<&'static str> {
    candidates
        .iter()
        .copied()
        .find(|candidate| (!candidate.starts_with('/') || exists(candidate)) && probe(candidate))
}

fn discover(candidates: &'static [&'static str]) -> Option<&'static str> {
    discover_with(
        candidates,
        |candidate| Path::new(candidate).is_file(),
        |candidate| {
            crate::process_runner::optional(|| {
                Command::new(candidate)
                    .arg("--version")
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .bounded_status()
                    .is_ok_and(|status| status.success())
            })
        },
    )
}

fn cached_success(
    cache: &'static OnceLock<&'static str>,
    candidates: &'static [&'static str],
) -> Option<&'static str> {
    cache.get().copied().or_else(|| {
        let found = discover(candidates)?;
        let _ = cache.set(found);
        Some(found)
    })
}

fn read_tool() -> Option<&'static str> {
    cached_success(&READ_TOOL, KREADCONFIG)
}
fn write_tool() -> Option<&'static str> {
    cached_success(&WRITE_TOOL, KWRITECONFIG)
}
fn dbus_tool() -> Option<&'static str> {
    cached_success(&DBUS_TOOL, QDBUS)
}

pub(super) const UNSET: &str = "__AMS_ACCESS_UNSET_CONFIG_KEY__";

pub(super) fn config_get(file: &str, group: &str, key: &str) -> Option<String> {
    let output = Command::new(read_tool()?)
        .args([
            "--file",
            file,
            "--group",
            group,
            "--key",
            key,
            "--default",
            UNSET,
        ])
        .bounded_output()
        .ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string()
    })
}

pub(super) fn config_set(file: &str, group: &str, key: &str, value: &str) -> bool {
    let Some(tool) = write_tool() else {
        return false;
    };
    let mut command = Command::new(tool);
    command.args(["--file", file, "--group", group, "--key", key]);
    if value == UNSET {
        command.arg("--delete");
    } else {
        command.arg(value);
    }
    command
        .bounded_status()
        .is_ok_and(|status| status.success())
        && config_get(file, group, key).is_some_and(|actual| actual == value)
}

/// Reload kwinrc after legacy recovery. KGlobalAccel has no `reconfigure`
/// method, so this deliberately makes no claim about shortcut-file liveness.
pub(super) fn reconfigure_kwin() -> bool {
    let Some(tool) = dbus_tool() else {
        return false;
    };
    crate::process_runner::optional(|| {
        Command::new(tool)
            .args(["org.kde.KWin", "/KWin", "reconfigure"])
            .bounded_status()
            .is_ok_and(|status| status.success())
    })
}

#[cfg(test)]
mod tests {
    use super::{discover_with, QDBUS};

    #[test]
    fn arch_qt6_location_precedes_legacy_fallbacks() {
        let mut visited = Vec::new();
        assert_eq!(
            discover_with(
                QDBUS,
                |_| true,
                |candidate| {
                    visited.push(candidate.to_string());
                    candidate == "/usr/lib/qt6/bin/qdbus"
                }
            ),
            Some("/usr/lib/qt6/bin/qdbus")
        );
        assert_eq!(
            visited,
            vec!["qdbus6", "qdbus-qt6", "/usr/lib/qt6/bin/qdbus"]
        );
    }

    #[test]
    fn missing_absolute_candidate_is_not_executed() {
        let candidates: &'static [&'static str] = &["/missing/tool6", "tool5"];
        let mut probed = Vec::new();
        assert_eq!(
            discover_with(
                candidates,
                |candidate| candidate != "/missing/tool6",
                |candidate| {
                    probed.push(candidate.to_string());
                    true
                }
            ),
            Some("tool5")
        );
        assert_eq!(probed, vec!["tool5"]);
    }
}
