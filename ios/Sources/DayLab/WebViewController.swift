import UIKit
import WebKit
import AuthenticationServices
import AVFoundation
import Speech
import HealthKit

private let appURL = URL(string: "https://www.daylab.me")!

class WebViewController: UIViewController {

    // MARK: - Views

    private lazy var webView: WKWebView = {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.insetsLayoutMarginsFromSafeArea = false
        wv.isOpaque = false
        wv.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.10, alpha: 1)
        wv.scrollView.backgroundColor = wv.backgroundColor
        wv.allowsBackForwardNavigationGestures = true

        let script = WKUserScript(
            source: """
                Object.defineProperty(window, 'daylabNative', {
                    value: { platform: 'ios', version: '1.0.0' },
                    writable: false,
                    configurable: false
                });
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        wv.configuration.userContentController.addUserScript(script)
        wv.configuration.userContentController.add(self, name: "daylabRequestHealthKit")

        return wv
    }()

    private lazy var refreshControl: UIRefreshControl = {
        let rc = UIRefreshControl()
        rc.tintColor = UIColor(white: 0.4, alpha: 1)
        rc.addTarget(self, action: #selector(reload), for: .valueChanged)
        return rc
    }()

    private lazy var offlineView: UIView = {
        let v = UIView()
        v.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.10, alpha: 1)
        v.isHidden = true

        let stack = UIStackView()
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        let icon = UILabel()
        icon.text = "⚡"
        icon.font = .systemFont(ofSize: 36)

        let msg = UILabel()
        msg.text = "No connection"
        msg.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        msg.textColor = UIColor(white: 0.4, alpha: 1)

        let btn = UIButton(type: .system)
        btn.setTitle("TRY AGAIN", for: .normal)
        btn.titleLabel?.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        btn.setTitleColor(UIColor(white: 0.5, alpha: 1), for: .normal)
        btn.layer.borderColor = UIColor(white: 0.25, alpha: 1).cgColor
        btn.layer.borderWidth = 1
        btn.layer.cornerRadius = 6
        var config = UIButton.Configuration.plain()
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16)
        btn.configuration = config
        btn.addTarget(self, action: #selector(reload), for: .touchUpInside)

        [icon, msg, btn].forEach { stack.addArrangedSubview($0) }
        v.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: v.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: v.centerYAnchor),
        ])
        return v
    }()

    private var authSession: ASWebAuthenticationSession?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.10, alpha: 1)
        setupLayout()
        loadApp()
        // Configure audio session for microphone access
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - Layout

    private func setupLayout() {
        [webView, offlineView].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview($0)
            NSLayoutConstraint.activate([
                $0.topAnchor.constraint(equalTo: view.topAnchor),
                $0.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                $0.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                $0.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            ])
        }
        webView.scrollView.addSubview(refreshControl)
    }

    // MARK: - Loading

    private func loadApp() {
        webView.load(URLRequest(url: appURL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 15))
    }

    @objc private func reload() {
        offlineView.isHidden = true
        webView.isHidden = false
        if webView.url == nil {
            loadApp()
        } else {
            // Post message to web app to trigger data sync
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('daylabRefresh'))") { _, _ in }
        }
        // Sync HealthKit data
        syncHealthKit()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            self.refreshControl.endRefreshing()
        }
    }

    private func syncHealthKit() {
        // Notify web of status (via data probe) and sync in one shot
        // The probe in checkStatusAndNotify already queries HealthKit — if it succeeds
        // we have access; the sync will simply return no data if we don't
        webView.evaluateJavaScript("localStorage.getItem('daylab:token')") { result, _ in
            guard let token = result as? String, !token.isEmpty else {
                // Still notify status even without token
                HealthKitSync.shared.checkStatusAndNotify(webView: self.webView)
                return
            }
            HealthKitSync.shared.checkStatusAndNotify(webView: self.webView)
            HealthKitSync.shared.syncHealthKit(token: token, date: Date(), webView: self.webView)
        }
    }

    // Called when web sends daylabRequestHealthKit — user tapped "Connect"
    private func requestHealthKitPermission(tokenHint: String? = nil) {
        print("DAYLAB-HK: requestHealthKitPermission called, tokenHint=\(tokenHint?.isEmpty == false ? "yes" : "nil/empty")")
        HealthKitSync.shared.requestPermission { [weak self] granted in
            print("DAYLAB-HK: requestPermission callback, granted=\(granted)")
            guard let self = self else { return }
            let statusStr = granted ? "authorized" : "denied"
            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("""
                    window.dispatchEvent(new CustomEvent('daylabHealthKit', {
                        detail: { status: '\(statusStr)' }
                    }));
                """, completionHandler: nil)
            }
            guard granted else { return }
            if let t = tokenHint, !t.isEmpty {
                HealthKitSync.shared.syncHealthKit(token: t, date: Date(), webView: self.webView)
            } else {
                self.webView.evaluateJavaScript("localStorage.getItem('daylab:token')") { result, _ in
                    if let token = result as? String, !token.isEmpty {
                        HealthKitSync.shared.syncHealthKit(token: token, date: Date(), webView: self.webView)
                    }
                }
            }
        }
    }

    // MARK: - Google OAuth via ASWebAuthenticationSession

    private func startOAuth(url: URL) {
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: "daylab"
        ) { [weak self] callbackURL, error in
            guard let self = self, let callbackURL = callbackURL else { return }
            self.handleDeepLink(callbackURL)
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.authSession = session
        session.start()
    }

    // MARK: - Deep link (daylab:// OAuth callback)

    func handleDeepLink(_ url: URL) {
        // daylab://auth/callback?code=xxx
        // In this URL, "auth" is the host and "/callback" is the path
        // We need to translate to https://www.daylab.me/auth/callback?code=xxx
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let originalHost = components.host ?? "" // "auth"
        let originalPath = components.path       // "/callback"
        components.scheme = "https"
        components.host = "www.daylab.me"
        components.path = "/\(originalHost)\(originalPath)" // "/auth/callback"
        if let translated = components.url {
            webView.load(URLRequest(url: translated))
        }
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

extension WebViewController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return view.window!
    }
}

// MARK: - WKNavigationDelegate

extension WebViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
        offlineView.isHidden = true
        // Delay slightly to let JS session initialize
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            self.syncHealthKit()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        refreshControl.endRefreshing()
        showOffline(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        refreshControl.endRefreshing()
        showOffline(error)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }

        let host = url.host ?? ""
        let isOAuthReturn = url.scheme == "daylab"
        let isGoogleAuth = host.contains("accounts.google.com")
        let isSupabaseAuth = host.contains("supabase.co") && url.path.contains("/auth")
        let isInternal = host.contains("daylab.me") || host.contains("supabase.co")

        if isOAuthReturn {
            handleDeepLink(url)
            decisionHandler(.cancel)
        } else if isGoogleAuth || isSupabaseAuth {
            // Use ASWebAuthenticationSession for OAuth — handles daylab:// callback correctly
            startOAuth(url: url)
            decisionHandler(.cancel)
        } else if !isInternal && navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    private func showOffline(_ error: Error) {
        let nsError = error as NSError
        if nsError.code == 102 { return }
        webView.isHidden = true
        offlineView.isHidden = false
    }
}

// MARK: - WKUIDelegate

extension WebViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            UIApplication.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
}

// MARK: - WKScriptMessageHandler

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        if message.name == "daylabRequestHealthKit" {
            print("DAYLAB-HK: message received from web, body=\(message.body)")
            // Extract token from message body if provided (most reliable path)
            let bodyToken: String?
            if let body = message.body as? [String: Any],
               let t = body["token"] as? String, !t.isEmpty {
                bodyToken = t
            } else {
                bodyToken = nil
            }
            requestHealthKitPermission(tokenHint: bodyToken)
        }
    }
}
