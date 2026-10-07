/// Only guest hardware identity is evidence here. The rest of systeminfo can
/// describe host-only adapters, installed virtualization software, or bare-metal VBS.
/// Unknown/localized field labels deliberately do not count as evidence.
pub(super) fn systeminfo_guest_platform(text: &str) -> Option<&'static str> {
    for line in text.lines() {
        let Some((label, value)) = line.split_once(':') else {
            continue;
        };
        if !matches!(
            label.trim().to_ascii_lowercase().as_str(),
            "system manufacturer" | "system model"
        ) {
            continue;
        }
        let value = value.trim().to_ascii_lowercase();
        for (marker, platform) in [
            ("vmware", "vmware"),
            ("virtualbox", "virtualbox"),
            ("virtual machine", "virtual machine"),
            ("hyper-v", "hyper-v"),
            ("kvm", "kvm"),
            ("xen", "xen"),
            ("qemu", "qemu"),
            ("parallels", "parallels"),
        ] {
            if value.match_indices(marker).any(|(start, matched)| {
                let end = start + matched.len();
                let is_word = |c: char| c.is_ascii_alphanumeric() || c == '_';
                !value[..start].chars().next_back().is_some_and(is_word)
                    && !value[end..].chars().next().is_some_and(is_word)
            }) {
                return Some(platform);
            }
        }
    }
    None
}

/// Registry value names are stable across Windows display languages.
pub(super) fn registry_guest_platform(text: &str) -> Option<&'static str> {
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let label = match fields.next() {
            Some("SystemManufacturer") => "System Manufacturer",
            Some("SystemProductName") => "System Model",
            _ => continue,
        };
        if fields.next() != Some("REG_SZ") {
            continue;
        }
        let value = fields.collect::<Vec<_>>().join(" ");
        if let Some(platform) = systeminfo_guest_platform(&format!("{label}: {value}")) {
            return Some(platform);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::systeminfo_guest_platform;

    #[test]
    fn physical_host_with_virtualization_adapters_and_vbs_is_not_a_guest() {
        let text = "System Manufacturer: Dell Inc.\r\n\
                    System Model: XPS 15 9530\r\n\
                    Network Card(s): 3 NIC(s) Installed.\r\n\
                    [01]: VirtualBox Host-Only Ethernet Adapter\r\n\
                    [02]: VMware Virtual Ethernet Adapter for VMnet8\r\n\
                    [03]: Hyper-V Virtual Ethernet Adapter\r\n\
                    Hyper-V Requirements: A hypervisor has been detected.\r\n\
                    Virtualization-based security: Running\r\n";
        assert_eq!(systeminfo_guest_platform(text), None);
    }

    #[test]
    fn guest_hardware_remains_detected_without_guest_tools() {
        for (manufacturer, model, platform) in [
            ("innotek GmbH", "VirtualBox", "virtualbox"),
            ("VMware, Inc.", "VMware Virtual Platform", "vmware"),
            (
                "Microsoft Corporation",
                "Virtual Machine",
                "virtual machine",
            ),
            ("QEMU", "Standard PC (Q35 + ICH9, 2009)", "qemu"),
            ("Red Hat", "KVM", "kvm"),
            ("Xen", "HVM domU", "xen"),
            (
                "Parallels Software International Inc.",
                "Parallels Virtual Platform",
                "parallels",
            ),
            ("Microsoft Corporation", "Hyper-V", "hyper-v"),
        ] {
            let text = format!("System Manufacturer: {manufacturer}\nSystem Model: {model}");
            assert_eq!(systeminfo_guest_platform(&text), Some(platform), "{text}");
        }
    }

    #[test]
    fn unrelated_fields_and_continuation_lines_are_not_hardware_identity() {
        for text in [
            "Host Name: VIRTUALBOX\nOS Manufacturer: VMware\nSystem Type: KVM",
            "System Model: Physical PC\n    VirtualBox Host-Only Ethernet Adapter",
            "System Manufacturer: Dell Inc.\nSystem Model: Xenon Workstation",
            "System Model: NotVirtualBox\nSystem Manufacturer: QEMUnique",
            "Fabricant du système: VMware\nModèle du système: VirtualBox",
            "",
        ] {
            assert_eq!(systeminfo_guest_platform(text), None, "{text}");
        }
    }

    #[test]
    fn registry_identity_ignores_unrelated_values() {
        assert_eq!(
            super::registry_guest_platform(
                "    SystemManufacturer    REG_SZ    ASUSTeK COMPUTER INC.\n    SystemProductName    REG_SZ    Vivobook_ASUSLaptop K5504VA_S5504VA\n    BIOSVersion    REG_SZ    VirtualBox"
            ),
            None
        );
        for model in [
            "VirtualBox",
            "VMware Virtual Platform",
            "Virtual Machine",
            "KVM",
        ] {
            assert!(super::registry_guest_platform(&format!(
                "    SystemProductName    REG_SZ    {model}"
            ))
            .is_some());
        }
        assert_eq!(
            super::registry_guest_platform("SystemProductName REG_BINARY VirtualBox"),
            None
        );
    }

    #[test]
    #[ignore = "requires a physical Windows host; run explicitly for native diagnostics"]
    fn live_physical_host_scan() {
        let budget = crate::process_runner::Budget::new(std::time::Duration::from_secs(20));
        let processes = super::super::scan_processes();
        let virt = super::super::detect_virtualization();
        println!(
            "processes={processes:?}, virtualization={virt:?}, failure={:?}",
            budget.failure()
        );
        assert!(
            budget.failure().is_none(),
            "native scan failed: {:?}",
            budget.failure()
        );
        assert!(!virt.detected, "physical host misidentified: {virt:?}");
    }

    #[test]
    fn hardware_fields_allow_case_whitespace_and_punctuation() {
        assert_eq!(
            systeminfo_guest_platform("  SYSTEM MODEL :  vIrTuAlBoX (ICH9)\r\n"),
            Some("virtualbox")
        );
    }
}
