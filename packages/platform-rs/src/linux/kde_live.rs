use crate::process_runner::CommandDeadlineExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;

const SERVICE: &str = "org.kde.kglobalaccel";
const OBJECT: &str = "/kglobalaccel";
const INTERFACE: &str = "org.kde.KGlobalAccel";
const GDBUS_CANDIDATES: &[&str] = &["gdbus", "/usr/bin/gdbus"];

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(super) struct Plan {
    pub action_id: [String; 4],
    pub original: Vec<Vec<i32>>,
    pub applied: Vec<Vec<i32>>,
}

pub(super) trait BusCall {
    fn call(&mut self, method: &str, args: &[String]) -> Option<String>;
}

struct Gdbus {
    tool: &'static str,
}

impl Gdbus {
    fn discover() -> Option<Self> {
        let tool = GDBUS_CANDIDATES.iter().copied().find(|candidate| {
            (!candidate.starts_with('/') || std::path::Path::new(candidate).is_file())
                && crate::process_runner::optional(|| {
                    Command::new(candidate)
                        .arg("help")
                        .bounded_status()
                        .is_ok_and(|status| status.success())
                })
        })?;
        Some(Self { tool })
    }
}

impl BusCall for Gdbus {
    fn call(&mut self, method: &str, args: &[String]) -> Option<String> {
        let mut command = Command::new(self.tool);
        command.args([
            "call",
            "--session",
            "--dest",
            SERVICE,
            "--object-path",
            OBJECT,
            "--method",
            &format!("{INTERFACE}.{method}"),
        ]);
        command.args(args);
        let output = command.bounded_output().ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

pub(super) struct Adapter {
    bus: Gdbus,
    actions: HashMap<String, Vec<[String; 4]>>,
}

impl Adapter {
    pub(super) fn discover() -> Option<Self> {
        Some(Self {
            bus: Gdbus::discover()?,
            actions: HashMap::new(),
        })
    }

    pub(super) fn plan(&mut self, component: &str, action: &str) -> Option<Plan> {
        plan_cached_with(&mut self.bus, &mut self.actions, component, action)
    }

    pub(super) fn apply(&mut self, plan: &Plan) -> bool {
        apply_with(&mut self.bus, plan)
    }

    pub(super) fn restore(&mut self, plan: &Plan) -> bool {
        restore_with(&mut self.bus, plan)
    }
}

fn action_arg(action_id: &[String; 4]) -> String {
    glib::Variant::from(action_id.as_slice())
        .print(false)
        .to_string()
}

fn keys_arg(keys: &[Vec<i32>]) -> String {
    let wire = keys
        .iter()
        .cloned()
        .map(|sequence| (sequence,))
        .collect::<Vec<_>>();
    glib::Variant::from(wire).print(false).to_string()
}

fn parse_actions(reply: &str) -> Option<Vec<[String; 4]>> {
    let value = glib::Variant::parse(None, reply).ok()?;
    if value.type_().as_str() != "(aas)" {
        return None;
    }
    Some(
        value
            .child_value(0)
            .iter()
            .filter_map(|action| {
                action
                    .iter()
                    .map(|field| field.str().map(str::to_string))
                    .collect::<Option<Vec<_>>>()?
                    .try_into()
                    .ok()
            })
            .collect(),
    )
}

fn parse_keys(reply: &str) -> Option<Vec<Vec<i32>>> {
    let value = glib::Variant::parse(None, reply).ok()?;
    if value.type_().as_str() != "(a(ai))" {
        return None;
    }
    value
        .child_value(0)
        .iter()
        .map(|sequence| {
            sequence
                .child_value(0)
                .iter()
                .map(|key| key.get::<i32>())
                .collect::<Option<Vec<_>>>()
        })
        .collect()
}

fn read_keys(bus: &mut impl BusCall, action_id: &[String; 4]) -> Option<Vec<Vec<i32>>> {
    parse_keys(&bus.call("shortcutKeys", &[action_arg(action_id)])?)
}

#[cfg(test)]
fn plan_with(bus: &mut impl BusCall, component: &str, action: &str) -> Option<Plan> {
    plan_cached_with(bus, &mut HashMap::new(), component, action)
}

fn plan_cached_with(
    bus: &mut impl BusCall,
    cache: &mut HashMap<String, Vec<[String; 4]>>,
    component: &str,
    action: &str,
) -> Option<Plan> {
    if !cache.contains_key(component) {
        let query = [
            component.to_string(),
            String::new(),
            String::new(),
            String::new(),
        ];
        let actions = parse_actions(&bus.call("allActionsForComponent", &[action_arg(&query)])?)?;
        cache.insert(component.to_string(), actions);
    }
    let action_id = cache
        .get(component)?
        .iter()
        .find(|candidate| candidate[0] == component && candidate[1] == action)?
        .clone();
    let original = read_keys(bus, &action_id)?;
    Some(Plan {
        action_id,
        original,
        applied: Vec::new(),
    })
}

fn set_and_verify(bus: &mut impl BusCall, action_id: &[String; 4], keys: &[Vec<i32>]) -> bool {
    let args = [action_arg(action_id), keys_arg(keys)];
    let Some(reply) = bus.call("setForeignShortcutKeys", &args) else {
        return false;
    };
    let replied = glib::Variant::parse(None, &reply)
        .ok()
        .is_some_and(|value| value.type_().as_str() == "()");
    replied && read_keys(bus, action_id).is_some_and(|actual| actual == keys)
}

fn apply_with(bus: &mut impl BusCall, plan: &Plan) -> bool {
    let Some(current) = read_keys(bus, &plan.action_id) else {
        return false;
    };
    if current == plan.applied {
        return true;
    }
    current == plan.original && set_and_verify(bus, &plan.action_id, &plan.applied)
}

fn restore_with(bus: &mut impl BusCall, plan: &Plan) -> bool {
    let Some(current) = read_keys(bus, &plan.action_id) else {
        return false;
    };
    if current == plan.original {
        return true;
    }
    current == plan.applied && set_and_verify(bus, &plan.action_id, &plan.original)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct Fixture {
        replies: VecDeque<Option<String>>,
        calls: Vec<(String, Vec<String>)>,
    }

    impl Fixture {
        fn new(replies: &[&str]) -> Self {
            Self {
                replies: replies.iter().map(|reply| Some((*reply).into())).collect(),
                calls: Vec::new(),
            }
        }
    }

    impl BusCall for Fixture {
        fn call(&mut self, method: &str, args: &[String]) -> Option<String> {
            self.calls.push((method.into(), args.to_vec()));
            self.replies.pop_front().flatten()
        }
    }

    #[test]
    fn planner_uses_discovered_four_field_identity_and_snapshots_keys() {
        let mut bus = Fixture::new(&[
            "([['kwin', 'Overview', 'KWin', 'Toggle Overview'], ['kwin', 'Other', 'KWin', 'Other']],)",
            "([([134217807],)],)",
        ]);
        let plan = plan_with(&mut bus, "kwin", "Overview").unwrap();
        assert_eq!(
            plan,
            Plan {
                action_id: [
                    "kwin".into(),
                    "Overview".into(),
                    "KWin".into(),
                    "Toggle Overview".into()
                ],
                original: vec![vec![134217807]],
                applied: vec![],
            }
        );
        assert_eq!(bus.calls[1].0, "shortcutKeys");
    }

    #[test]
    fn action_discovery_is_cached_per_component_but_keys_remain_per_action() {
        let mut bus = Fixture::new(&[
            "([['kwin', 'Overview', 'KWin', 'Overview'], ['kwin', 'Expose', 'KWin', 'Expose']],)",
            "([([1],)],)",
            "([([2],)],)",
        ]);
        let mut cache = HashMap::new();
        assert!(plan_cached_with(&mut bus, &mut cache, "kwin", "Overview").is_some());
        assert!(plan_cached_with(&mut bus, &mut cache, "kwin", "Expose").is_some());
        assert_eq!(
            bus.calls
                .iter()
                .filter(|(method, _)| method == "allActionsForComponent")
                .count(),
            1
        );
        assert_eq!(
            bus.calls
                .iter()
                .filter(|(method, _)| method == "shortcutKeys")
                .count(),
            2
        );
    }

    #[test]
    fn absent_action_is_skipped_without_fabricating_an_identity() {
        let mut bus = Fixture::new(&["([['kwin', 'Other', 'KWin', 'Other']],)"]);
        assert!(plan_with(&mut bus, "kwin", "Overview").is_none());
        assert_eq!(bus.calls.len(), 1);
    }

    #[test]
    fn apply_requires_setter_return_and_independent_empty_readback() {
        let shortcut = Plan {
            action_id: [
                "kwin".into(),
                "Overview".into(),
                "KWin".into(),
                "Overview".into(),
            ],
            original: vec![vec![1]],
            applied: vec![],
        };
        let mut accepted = Fixture::new(&["([([1],)],)", "()", "(@a(ai) [],)"]);
        assert!(apply_with(&mut accepted, &shortcut));
        assert_eq!(accepted.calls[1].0, "setForeignShortcutKeys");
        assert_eq!(accepted.calls[1].1.len(), 2);

        let mut stale = Fixture::new(&["([([2],)],)"]);
        assert!(!apply_with(&mut stale, &shortcut));
    }

    #[test]
    fn repeated_apply_accepts_verified_applied_state_without_another_write() {
        let shortcut = Plan {
            action_id: [
                "kwin".into(),
                "Overview".into(),
                "KWin".into(),
                "Overview".into(),
            ],
            original: vec![vec![1]],
            applied: vec![],
        };
        let mut bus = Fixture::new(&["(@a(ai) [],)"]);
        assert!(apply_with(&mut bus, &shortcut));
        assert_eq!(
            bus.calls
                .iter()
                .map(|(method, _)| method.as_str())
                .collect::<Vec<_>>(),
            vec!["shortcutKeys"]
        );
    }

    #[test]
    fn restore_requires_original_keys_in_return_and_readback() {
        let shortcut = Plan {
            action_id: [
                "kwin".into(),
                "Overview".into(),
                "KWin".into(),
                "Overview".into(),
            ],
            original: vec![vec![1, 2]],
            applied: vec![],
        };
        let mut bus = Fixture::new(&["(@a(ai) [],)", "()", "([([1, 2],)],)"]);
        assert!(restore_with(&mut bus, &shortcut));
    }

    #[test]
    fn malformed_wire_reply_fails_closed() {
        assert!(parse_actions("not a variant").is_none());
        assert!(parse_keys("(['wrong type'],)").is_none());
    }
}
