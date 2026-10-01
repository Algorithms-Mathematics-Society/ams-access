//! Verify complete rule names from a structured inventory, independently of
//! localized netsh labels or unrelated descriptions. Tests never change rules.
pub(super) const AMS_RULES: [&str; 2] = ["AMS_PROCTOR_BLOCK_ALL", "AMS_PROCTOR_ALLOW"];

pub(super) fn cleanup(
    mut delete: impl FnMut(&str) -> Result<(), String>,
    inspect: impl FnOnce() -> Result<String, String>,
) -> Result<(), String> {
    // Always attempt both deletions; an absent rule may produce a nonzero exit.
    // Only a successful, complete inventory can establish that cleanup worked.
    for name in AMS_RULES {
        let _ = delete(name);
    }
    let inventory = inspect()?;
    let names: Vec<String> = serde_json::from_str(&inventory)
        .map_err(|_| "Firewall inventory was not a complete JSON list of rule names")?;
    let still_present = names.iter().any(|name| {
        AMS_RULES
            .iter()
            .any(|owned| name.eq_ignore_ascii_case(owned))
    });
    if still_present {
        Err("AMS firewall rules remain active. Retry restoring network access with administrator permission.".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_denied_is_not_success_when_rules_remain() {
        let mut attempts = Vec::new();
        let result = cleanup(
            |name| {
                attempts.push(name.to_owned());
                Err("access denied".into())
            },
            || Ok(r#"["AMS_PROCTOR_BLOCK_ALL"]"#.into()),
        );
        assert!(result.is_err());
        assert_eq!(attempts, AMS_RULES);
    }

    #[test]
    fn missing_rules_are_idempotent_only_after_successful_inventory() {
        assert!(cleanup(
            |_| Err("localized no matching rule".into()),
            || Ok("[]".into())
        )
        .is_ok());
        assert!(cleanup(|_| Ok(()), || Err("inventory timed out".into())).is_err());
    }

    #[test]
    fn invalid_or_incomplete_inventory_is_not_evidence_of_cleanup() {
        for invalid in [
            "",
            "null",
            "{}",
            "[null]",
            "[1]",
            "[",
            "[] trailing",
            "A\0M\0S\0",
        ] {
            assert!(
                cleanup(|_| Ok(()), || Ok(invalid.into())).is_err(),
                "{invalid:?}"
            );
        }
    }

    #[test]
    fn full_rule_names_do_not_match_backups_prefixes_suffixes_or_descriptions() {
        let names = serde_json::json!([
            "AMS_PROCTOR_ALLOW (backup)",
            "AMS_PROCTOR_ALLOW-old",
            "OLD_AMS_PROCTOR_ALLOW",
            "AMS_PROCTOR_ALLOW_other",
            "Description mentions AMS_PROCTOR_BLOCK_ALL",
            "规则名称：AMS_PROCTOR_ALLOW",
        ]);
        assert!(cleanup(|_| Ok(()), || Ok(names.to_string())).is_ok());
    }

    #[test]
    fn either_owned_name_including_case_variants_prevents_success() {
        for name in [
            "AMS_PROCTOR_ALLOW",
            "AMS_PROCTOR_BLOCK_ALL",
            "ams_proctor_allow",
        ] {
            let names = serde_json::json!(["Other rule", name]);
            assert!(cleanup(|_| Ok(()), || Ok(names.to_string())).is_err());
        }
    }
}
