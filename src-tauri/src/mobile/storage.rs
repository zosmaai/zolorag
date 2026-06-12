//! Android content URI → local file copy.
//!
//! The Android file picker (and Share intent) hands us a `content://` URI, not
//! a real filesystem path. `pdf-extract` / `lopdf` need a real path, so we
//! stream the URI's bytes via `ContentResolver.openInputStream(...)` into the
//! app's private cache directory and hand back the local `PathBuf`.
//!
//! This file is `#[cfg(target_os = "android")]` — desktop never sees it.

#![cfg(target_os = "android")]

use jni::objects::{JObject, JValue};
use jni::JavaVM;
use std::ops::Deref;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Copy the bytes referenced by a `content://` URI into `dest_dir`.
///
/// Returns the local `PathBuf` of the copied file. The file name is derived
/// from the URI's `DISPLAY_NAME` column when available, otherwise a hash of
/// the URI is used so re-opens are stable.
pub fn copy_content_uri_to_app_storage(uri: &str, dest_dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("create cache dir: {e}"))?;

    // ---- JNI bootstrap ------------------------------------------------------
    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("attach JavaVM: {e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("attach thread: {e}"))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // ---- resolver = activity.getContentResolver() ---------------------------
    let resolver = env
        .call_method(
            &activity,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("getContentResolver: {e}"))?;

    // ---- uri_obj = Uri.parse(uri) -------------------------------------------
    let uri_jstr = env
        .new_string(uri)
        .map_err(|e| format!("new_string(uri): {e}"))?;
    let uri_class = env
        .find_class("android/net/Uri")
        .map_err(|e| format!("find Uri class: {e}"))?;
    let uri_obj = env
        .call_static_method(
            uri_class,
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[(&uri_jstr).into()],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("Uri.parse: {e}"))?;

    // ---- determine display name --------------------------------------------
    let file_name = query_display_name(&mut env, &resolver, &uri_obj)
        .unwrap_or_else(|| short_hash_name(uri));
    let dest_path = dest_dir.join(&file_name);

    // ---- stream = resolver.openInputStream(uri_obj) -------------------------
    let stream = env
        .call_method(
            &resolver,
            "openInputStream",
            "(Landroid/net/Uri;)Ljava/io/InputStream;",
            &[(&uri_obj).into()],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("openInputStream: {e}"))?;

    if stream.is_null() {
        return Err(format!("ContentResolver returned null InputStream for {uri}"));
    }

    // ---- copy bytes to disk -------------------------------------------------
    let mut out =
        File::create(&dest_path).map_err(|e| format!("create {}: {e}", dest_path.display()))?;

    const CHUNK: i32 = 64 * 1024;
    let buf = env
        .new_byte_array(CHUNK)
        .map_err(|e| format!("alloc buffer: {e}"))?;

    loop {
        // JByteArray derefs to JObject; pass &*buf so JValue::Object accepts it.
        let n = env
            .call_method(
                &stream,
                "read",
                "([B)I",
                &[JValue::Object(buf.deref())],
            )
            .and_then(|v| v.i())
            .map_err(|e| format!("InputStream.read: {e}"))?;

        if n <= 0 {
            break;
        }

        let mut tmp = vec![0i8; n as usize];
        env.get_byte_array_region(&buf, 0, &mut tmp)
            .map_err(|e| format!("get_byte_array_region: {e}"))?;
        // jni gives us i8 — reinterpret as u8 for Write.
        let bytes: &[u8] =
            unsafe { std::slice::from_raw_parts(tmp.as_ptr() as *const u8, tmp.len()) };
        out.write_all(bytes)
            .map_err(|e| format!("write {}: {e}", dest_path.display()))?;
    }

    // ---- close stream -------------------------------------------------------
    let _ = env.call_method(&stream, "close", "()V", &[]);

    out.flush().ok();
    Ok(dest_path)
}

/// Best-effort `DISPLAY_NAME` lookup via ContentResolver.query(…).
/// Returns `None` if the column is absent or the query throws — caller falls
/// back to a hash-based name.
fn query_display_name(
    env: &mut jni::AttachGuard,
    resolver: &JObject,
    uri_obj: &JObject,
) -> Option<String> {
    let column = env.new_string("_display_name").ok()?;
    let projection = env
        .new_object_array(1, "java/lang/String", &column)
        .ok()?;

    let cursor = env
        .call_method(
            resolver,
            "query",
            "(Landroid/net/Uri;[Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;)Landroid/database/Cursor;",
            &[
                JValue::Object(uri_obj),
                JValue::Object(&JObject::from(projection)),
                JValue::Object(&JObject::null()),
                JValue::Object(&JObject::null()),
                JValue::Object(&JObject::null()),
            ],
        )
        .ok()?
        .l()
        .ok()?;

    if cursor.is_null() {
        return None;
    }

    let moved = env
        .call_method(&cursor, "moveToFirst", "()Z", &[])
        .ok()?
        .z()
        .ok()?;
    if !moved {
        let _ = env.call_method(&cursor, "close", "()V", &[]);
        return None;
    }

    let name_jstr = env
        .call_method(&cursor, "getString", "(I)Ljava/lang/String;", &[JValue::Int(0)])
        .ok()?
        .l()
        .ok()?;
    let _ = env.call_method(&cursor, "close", "()V", &[]);

    if name_jstr.is_null() {
        return None;
    }
    let s: String = env
        .get_string(&jni::objects::JString::from(name_jstr))
        .ok()?
        .into();
    Some(sanitize(&s))
}

/// Replace path separators / weird chars so the URI's display name is safe
/// to use as a file name.
fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect()
}

/// Deterministic fallback name when DISPLAY_NAME isn't available.
fn short_hash_name(uri: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    uri.hash(&mut h);
    format!("pdf-{:016x}.pdf", h.finish())
}
