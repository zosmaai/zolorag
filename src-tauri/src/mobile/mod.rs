//! Mobile-only helpers. All submodules are `#[cfg(target_os = "android")]` and
//! must never be referenced from desktop code.

#[cfg(target_os = "android")]
pub mod storage;
