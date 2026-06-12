package com.zosmaai.zolorag

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

/**
 * MainActivity: capture incoming PDF intents (VIEW / SEND) and forward the
 * URI to the WebView via `window.__zoloragPdfIntent(uri)`.
 *
 * - Cold launch  : intent is captured in onCreate, dispatched after WebView is ready.
 * - Warm launch  : onNewIntent → dispatchPdfIntent immediately.
 *
 * The JS side (src/app/page.tsx) installs `window.__zoloragPdfIntent`, calls
 * the Rust `resolve_pdf_path` command to copy the content URI into app cache,
 * then loads the PDF.
 */
class MainActivity : TauriActivity() {

  private var pendingPdfUri: String? = null
  private var webViewRef: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    pendingPdfUri = extractPdfUri(intent)
    if (pendingPdfUri != null) {
      Log.i(TAG, "Cold-launch PDF intent queued: $pendingPdfUri")
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    pendingPdfUri?.let {
      dispatchPdfIntent(it)
      pendingPdfUri = null
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val uri = extractPdfUri(intent) ?: return
    Log.i(TAG, "Warm-launch PDF intent: $uri")
    if (webViewRef != null) {
      dispatchPdfIntent(uri)
    } else {
      pendingPdfUri = uri
    }
  }

  /** Extract a PDF URI from a VIEW or SEND intent. Returns null if absent. */
  private fun extractPdfUri(intent: Intent?): String? {
    intent ?: return null
    val uri: Uri? = when (intent.action) {
      Intent.ACTION_VIEW -> intent.data
      Intent.ACTION_SEND -> {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
      }
      else -> null
    }
    return uri?.toString()
  }

  /** Inject the URI into the JS layer. Frontend handles content URI resolution. */
  private fun dispatchPdfIntent(uri: String) {
    val webView = webViewRef ?: return
    // Escape backslash and single-quote for safe JS string literal.
    val safe = uri.replace("\\", "\\\\").replace("'", "\\'")
    val js = "if (window.__zoloragPdfIntent) { window.__zoloragPdfIntent('$safe'); }"
    webView.post {
      webView.evaluateJavascript(js, null)
    }
  }

  companion object {
    private const val TAG = "ZoloRagIntent"
  }
}
