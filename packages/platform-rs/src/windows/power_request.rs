//! One process-owned request, independent of the worker thread that enters or exits.
use std::sync::Mutex;

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Power::{
    PowerClearRequest, PowerCreateRequest, PowerRequestDisplayRequired, PowerRequestSystemRequired,
    PowerSetRequest, POWER_REQUEST_TYPE,
};
use windows::Win32::System::Threading::{
    POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0,
};

#[derive(Clone, Copy)]
enum Held<H> {
    Active(H),
    ClosePending(H),
}

static REQUEST: Mutex<Option<Held<isize>>> = Mutex::new(None);

trait Api {
    type Handle: Copy;
    fn create(&mut self) -> Result<Self::Handle, String>;
    fn set(&mut self, handle: Self::Handle, kind: POWER_REQUEST_TYPE) -> Result<(), String>;
    fn clear(&mut self, handle: Self::Handle, kind: POWER_REQUEST_TYPE) -> Result<(), String>;
    fn close(&mut self, handle: Self::Handle) -> Result<(), String>;
}

struct WindowsApi;

impl Api for WindowsApi {
    type Handle = isize;

    fn create(&mut self) -> Result<isize, String> {
        let mut reason: Vec<u16> = "AMS Access contest"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let context = REASON_CONTEXT {
            Version: 0,
            Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
            Reason: REASON_CONTEXT_0 {
                SimpleReasonString: PWSTR(reason.as_mut_ptr()),
            },
        };
        unsafe { PowerCreateRequest(&context) }
            .map(|handle| handle.0 as isize)
            .map_err(|error| format!("Create power request: {error}"))
    }

    fn set(&mut self, handle: isize, kind: POWER_REQUEST_TYPE) -> Result<(), String> {
        unsafe { PowerSetRequest(HANDLE(handle as *mut _), kind) }
            .map_err(|error| format!("Set power request: {error}"))
    }

    fn clear(&mut self, handle: isize, kind: POWER_REQUEST_TYPE) -> Result<(), String> {
        unsafe { PowerClearRequest(HANDLE(handle as *mut _), kind) }
            .map_err(|error| format!("Clear power request: {error}"))
    }

    fn close(&mut self, handle: isize) -> Result<(), String> {
        unsafe { CloseHandle(HANDLE(handle as *mut _)) }
            .map_err(|error| format!("Close power request: {error}"))
    }
}

fn change<A: Api>(
    held: &mut Option<Held<A::Handle>>,
    api: &mut A,
    enable: bool,
) -> Result<(), String> {
    if enable {
        match *held {
            Some(Held::Active(_)) => return Ok(()),
            Some(Held::ClosePending(handle)) => {
                api.close(handle)?;
                *held = None;
            }
            None => {}
        }
        let handle = api.create()?;
        let mut errors = Vec::new();
        if let Err(error) = api.set(handle, PowerRequestDisplayRequired) {
            errors.push(error);
        } else if let Err(error) = api.set(handle, PowerRequestSystemRequired) {
            errors.push(error);
            if let Err(error) = api.clear(handle, PowerRequestDisplayRequired) {
                errors.push(error);
            }
        }
        if errors.is_empty() {
            *held = Some(Held::Active(handle));
            return Ok(());
        }
        if let Err(error) = api.close(handle) {
            errors.push(error);
            *held = Some(Held::ClosePending(handle));
        }
        return Err(errors.join("; "));
    }

    let Some(state) = *held else {
        return Ok(());
    };
    let handle = match state {
        Held::Active(handle) => handle,
        Held::ClosePending(handle) => {
            api.close(handle)?;
            *held = None;
            return Ok(());
        }
    };
    let mut errors = Vec::new();
    for kind in [PowerRequestSystemRequired, PowerRequestDisplayRequired] {
        if let Err(error) = api.clear(handle, kind) {
            errors.push(error);
        }
    }
    // Closing the object releases remaining requests even if a clear failed.
    if let Err(error) = api.close(handle) {
        errors.push(error);
        *held = Some(Held::ClosePending(handle));
    } else {
        *held = None;
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

pub(super) fn set(enable: bool) -> Result<(), String> {
    let mut held = REQUEST.lock().unwrap_or_else(|error| error.into_inner());
    change(&mut *held, &mut WindowsApi, enable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fake {
        events: Vec<&'static str>,
        fail_system: bool,
        fail_close_once: bool,
    }

    impl Api for Fake {
        type Handle = usize;
        fn create(&mut self) -> Result<usize, String> {
            self.events.push("create");
            Ok(7)
        }
        fn set(&mut self, _: usize, kind: POWER_REQUEST_TYPE) -> Result<(), String> {
            if kind == PowerRequestDisplayRequired {
                self.events.push("display");
            } else {
                self.events.push("system");
                if self.fail_system {
                    return Err("system denied".into());
                }
            }
            Ok(())
        }
        fn clear(&mut self, _: usize, kind: POWER_REQUEST_TYPE) -> Result<(), String> {
            self.events.push(if kind == PowerRequestDisplayRequired {
                "clear display"
            } else {
                "clear system"
            });
            Ok(())
        }
        fn close(&mut self, _: usize) -> Result<(), String> {
            self.events.push("close");
            if self.fail_close_once {
                self.fail_close_once = false;
                return Err("close denied".into());
            }
            Ok(())
        }
    }

    #[test]
    fn release_on_another_thread_is_idempotent() {
        let held = std::sync::Arc::new(Mutex::new(None));
        let first = held.clone();
        std::thread::spawn(move || {
            change(&mut *first.lock().unwrap(), &mut Fake::default(), true).unwrap();
        })
        .join()
        .unwrap();
        let mut fake = Fake::default();
        change(&mut *held.lock().unwrap(), &mut fake, true).unwrap();
        change(&mut *held.lock().unwrap(), &mut fake, false).unwrap();
        change(&mut *held.lock().unwrap(), &mut fake, false).unwrap();
        assert_eq!(fake.events, ["clear system", "clear display", "close"]);
        assert!(held.lock().unwrap().is_none());
    }

    #[test]
    fn partial_failure_clears_and_closes_without_publishing_handle() {
        let mut held = None;
        let mut fake = Fake {
            fail_system: true,
            ..Fake::default()
        };
        assert!(change(&mut held, &mut fake, true)
            .unwrap_err()
            .contains("system denied"));
        assert!(held.is_none());
        assert_eq!(
            fake.events,
            ["create", "display", "system", "clear display", "close"]
        );
    }

    #[test]
    fn failed_release_close_is_retried() {
        let mut held = None;
        let mut fake = Fake {
            fail_close_once: true,
            ..Fake::default()
        };
        change(&mut held, &mut fake, true).unwrap();
        assert!(change(&mut held, &mut fake, false)
            .unwrap_err()
            .contains("close denied"));
        assert!(matches!(held, Some(Held::ClosePending(7))));
        change(&mut held, &mut fake, false).unwrap();
        assert!(held.is_none());
        assert_eq!(
            fake.events
                .iter()
                .filter(|event| **event == "close")
                .count(),
            2
        );
    }

    #[test]
    fn failed_partial_install_close_must_finish_before_reenabling() {
        let mut held = None;
        let mut fake = Fake {
            fail_system: true,
            fail_close_once: true,
            ..Fake::default()
        };
        assert!(change(&mut held, &mut fake, true).is_err());
        assert!(matches!(held, Some(Held::ClosePending(7))));
        fake.fail_system = false;
        change(&mut held, &mut fake, true).unwrap();
        assert!(matches!(held, Some(Held::Active(7))));
        assert_eq!(
            fake.events,
            [
                "create",
                "display",
                "system",
                "clear display",
                "close",
                "close",
                "create",
                "display",
                "system"
            ]
        );
    }
}
