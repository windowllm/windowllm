// WindowLLM — headless Safari/WebKit extension test host.
//
// Loads the built extension folder (dist/) into a real WKWebExtensionController
// (Apple's WebKit WebExtension engine, same one Safari uses), attaches it to an
// offscreen WKWebView, navigates to the shared contract page, and reports its result.
//
// This exercises the ACTUAL extension code (content.js → inlined inject.js → the
// window.llm MAIN-world object) with NO Safari, NO enable toggle, NO signing, NO TCC.
//
// Exit code 0 means the real extension injected and every browser contract passed.
//
// Build: swiftc -swift-version 5 -O -o host host.swift -framework WebKit -framework AppKit

import WebKit
import AppKit
import Foundation

// ---- output ----
let verbose = ProcessInfo.processInfo.environment["WKWEBEXT_VERBOSE"] != nil
func logv(_ s: String) {
    FileHandle.standardError.write(Data("[host] \(s)\n".utf8))
}
func vlog(_ s: String) { if verbose { logv(s) } }
func emit(_ dict: [String: Any], exitCode: Int32) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    } else {
        print("{\"ok\":false,\"error\":\"json-encode-failed\"}")
    }
    fflush(stdout)
    exit(exitCode)
}

// ---- args ----
let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write(Data("usage: host <extensionDir> <pageURL> [timeoutSecs]\n".utf8))
    exit(2)
}
let extDir = URL(fileURLWithPath: args[1], isDirectory: true)
guard let pageURL = URL(string: args[2]) else { emit(["ok": false, "error": "bad-url"], exitCode: 2) }
let timeout = args.count >= 4 ? (Double(args[3]) ?? 25) : 25

// ---- one object plays delegate + window + tab + navigation delegate ----
final class Harness: NSObject, WKWebExtensionControllerDelegate, WKWebExtensionWindow,
                     WKWebExtensionTab, WKNavigationDelegate {
    var webView: WKWebView!
    var didEvaluate = false

    // WKWebExtensionControllerDelegate
    func webExtensionController(_ c: WKWebExtensionController,
                                openWindowsFor ctx: WKWebExtensionContext) -> [any WKWebExtensionWindow] { [self] }
    func webExtensionController(_ c: WKWebExtensionController,
                                focusedWindowFor ctx: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { self }

    // WKWebExtensionWindow
    func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] { [self] }
    func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? { self }

    // WKWebExtensionTab
    func webView(for context: WKWebExtensionContext) -> WKWebView? { webView }
    func url(for context: WKWebExtensionContext) -> URL? { webView?.url }
    func title(for context: WKWebExtensionContext) -> String? { webView?.title }

    // WKNavigationDelegate
    func webView(_ wv: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        vlog("didStartProvisionalNavigation url=\(wv.url?.absoluteString ?? "nil")")
    }
    func webView(_ wv: WKWebView, didCommit navigation: WKNavigation!) {
        vlog("didCommit url=\(wv.url?.absoluteString ?? "nil")")
    }
    func webView(_ wv: WKWebView, didFinish navigation: WKNavigation!) {
        vlog("didFinish url=\(wv.url?.absoluteString ?? "nil")")
    }
    func webView(_ wv: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        emit(["ok": false, "error": "nav-failed: \(error.localizedDescription)"], exitCode: 1)
    }
    func webView(_ wv: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        emit(["ok": false, "error": "provisional-nav-failed: \(error.localizedDescription)"], exitCode: 1)
    }
    // Accept the local test server's TLS cert (self-signed) if https is used.
    func webView(_ wv: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }

    var pollCount = 0
    func startPolling(_ wv: WKWebView) {
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] t in
            guard let self = self else { t.invalidate(); return }
            self.poll(wv)
        }
    }

    func poll(_ wv: WKWebView) {
        if didEvaluate { return }
        pollCount += 1
        let js = """
        JSON.stringify({
          rs: document.readyState,
          href: location.href,
          type: typeof window.llm,
          provider: (window.llm && window.llm.provider) || null,
          version: (window.llm && window.llm.version) || null,
          hasRequestSession: !!(window.llm && window.llm.requestSession),
          keys: window.llm ? Object.keys(window.llm) : [],
          contract: window.__windowllmExtensionE2E || null
        })
        """
        wv.evaluateJavaScript(js) { [weak self] result, error in
            guard let self = self else { return }
            if let error = error {
                logv("poll \(self.pollCount): eval-error: \(error.localizedDescription)")
                return
            }
            guard let s = result as? String,
                  let d = s.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
                logv("poll \(self.pollCount): no-result raw=\(String(describing: result))")
                return
            }
            let provider = obj["provider"] as? String
            vlog("poll \(self.pollCount): rs=\(obj["rs"] ?? "?") llm=\(obj["type"] ?? "?") provider=\(provider ?? "nil")")
            guard let contract = obj["contract"] as? [String: Any],
                  contract["done"] as? Bool == true else { return }

            let failed = (contract["failed"] as? NSNumber)?.intValue ?? -1
            if provider == "extension" && failed == 0 {
                self.didEvaluate = true
                var out = obj
                out["ok"] = true
                emit(out, exitCode: 0)
            } else {
                self.didEvaluate = true
                var out = obj
                out["ok"] = false
                out["error"] = provider == "extension"
                    ? "extension contract reported \(failed) failure(s)"
                    : "window.llm provider was not extension"
                emit(out, exitCode: 1)
            }
        }
    }
}

let harness = Harness()

// WKWebView needs an app + window-server session.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// Global timeout guard.
DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
    emit(["ok": false, "error": "timeout after \(timeout)s (no window.llm / no injection?)"], exitCode: 3)
}

Task { @MainActor in
    do {
        vlog("loading extension from \(extDir.path)")
        let ext = try await WKWebExtension(resourceBaseURL: extDir)
        vlog("extension loaded; displayName=\(ext.displayName ?? "nil")")
        let manifestErrors = ext.errors.map { $0.localizedDescription }
        if !manifestErrors.isEmpty {
            FileHandle.standardError.write(Data("manifest issues: \(manifestErrors)\n".utf8))
        }

        let ctx = WKWebExtensionContext(for: ext)
        // Grant host access + storage so content scripts inject on the test page.
        let allURLs = try WKWebExtension.MatchPattern(string: "<all_urls>")
        ctx.setPermissionStatus(.grantedExplicitly, for: allURLs)
        ctx.setPermissionStatus(.grantedExplicitly, for: WKWebExtension.Permission.storage)

        let controller = WKWebExtensionController(configuration: .nonPersistent())
        controller.delegate = harness
        try controller.load(ctx)
        vlog("context loaded into controller; hasBackground=\(ext.hasBackgroundContent)")

        // A normal browsing tab (that receives content-script injection) must use a
        // FRESH configuration wired to the controller — NOT ctx.webViewConfiguration,
        // which is reserved for the extension's own popup/background/options pages.
        let cfg = WKWebViewConfiguration()
        cfg.webExtensionController = controller
        let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: cfg)
        wv.navigationDelegate = harness
        harness.webView = wv

        // Host offscreen so the view is live (renders/executes) without stealing focus.
        let win = NSWindow(contentRect: NSRect(x: -3000, y: -3000, width: 1024, height: 768),
                           styleMask: [.borderless], backing: .buffered, defer: false)
        win.contentView = wv
        win.orderFront(nil)

        // Tell the controller our window/tab exists so it targets content scripts here.
        controller.didOpenWindow(harness)
        controller.didOpenTab(harness)

        vlog("starting load of \(pageURL.absoluteString)")
        wv.load(URLRequest(url: pageURL))
        harness.startPolling(wv)
    } catch {
        emit(["ok": false, "error": "setup-error: \(error.localizedDescription)"], exitCode: 1)
    }
}

app.run()
