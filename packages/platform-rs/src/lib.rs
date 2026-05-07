cfg_if::cfg_if! {
    if #[cfg(target_os = "linux")] {
        pub mod linux;
        pub use linux::*;
    } else if #[cfg(target_os = "windows")] {
        pub mod windows;
        pub use windows::*;
    } else if #[cfg(target_os = "macos")] {
        pub mod macos;
        pub use macos::*;
    }
}
