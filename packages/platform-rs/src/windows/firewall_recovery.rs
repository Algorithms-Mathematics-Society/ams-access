//! Verify the final firewall state rather than guessing from localized delete
//! diagnostics. This orchestration can be tested without Windows or elevation.
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
    if inventory.trim().is_empty() || inventory.contains('\0') {
        return Err("Firewall inventory was empty or used an unsupported encoding".into());
    }
    let still_present = inventory
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .any(|token| AMS_RULES.contains(&token));
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
            || Ok("Rule Name: AMS_PROCTOR_BLOCK_ALL\n".into()),
        );
        assert!(result.is_err());
        assert_eq!(attempts, AMS_RULES);
    }

    #[test]
    fn missing_rules_are_idempotent_only_after_successful_inventory() {
        assert!(cleanup(
            |_| Err("localized no matching rule".into()),
            || Ok("Rule Name: Other app\n".into())
        )
        .is_ok());
        assert!(cleanup(|_| Ok(()), || Err("inventory timed out".into())).is_err());
    }

    #[test]
    fn empty_or_undecoded_inventory_is_not_evidence_of_cleanup() {
        assert!(cleanup(|_| Ok(()), || Ok(String::new())).is_err());
        assert!(cleanup(|_| Ok(()), || Ok("A\0M\0S\0".into())).is_err());
    }

    #[test]
    fn inventory_matching_does_not_depend_on_localized_field_labels() {
        assert!(cleanup(|_| Ok(()), || Ok("Regelname: AMS_PROCTOR_ALLOW\n".into())).is_err());
        assert!(cleanup(|_| Ok(()), || Ok("规则名称：AMS_PROCTOR_ALLOW\n".into())).is_err());
        assert!(cleanup(
            |_| Ok(()),
            || Ok("Rule Name: OTHER_AMS_PROCTOR_ALLOW\n".into())
        )
        .is_ok());
    }
}
