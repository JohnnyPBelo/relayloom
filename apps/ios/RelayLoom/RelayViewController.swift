import UIKit
import WebKit

private struct GoBackend: RuntimeBackend {
    func start(data: String, assets: String) throws -> String {
        let result = RLStartCore(data, assets)
        guard let response = result["response"] else { throw RuntimeFailure.nativeFailure }
        return response
    }
    func stop() throws { if !RLStopCore() { throw RuntimeFailure.nativeFailure } }
}

final class RelayViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private static let runtime = RuntimeCoordinator(backend: GoBackend())
    private var lease: UInt64 = 0
    private var foreground = false
    private var endpoint: OriginPolicy?
    private var web: WKWebView?
    private var status: UILabel?
    private var rulesIdentifier: String?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var microphonePrompt = false
    private var pendingMediaDecision: OnceCompletion<WKPermissionDecision>?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.96, green: 0.96, blue: 0.94, alpha: 1)
        showStatus("A preparar o teu nó neste dispositivo…", retry: false)
    }

    func startForeground() {
        foreground = true
        guard lease == 0 else { return }
        showStatus("A iniciar a rede neste dispositivo…", retry: false)
        lease = Self.runtime.start(prepare: {
            guard let assets = Bundle.main.url(forResource: "web", withExtension: nil),
                  FileManager.default.fileExists(atPath: assets.appendingPathComponent("index.html").path) else { throw RuntimeFailure.unavailableAssets }
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            var data = support.appendingPathComponent("RelayLoom/core", isDirectory: true)
            try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700, .protectionKey: FileProtectionType.complete])
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try data.setResourceValues(values)
            return (data.path, assets.path)
        }, completion: { [weak self] current, result in
            DispatchQueue.main.async {
                guard let self, self.foreground, Self.runtime.isCurrent(current) else { Self.runtime.stop(current); return }
                do {
                    let policy = try OriginPolicy(response: result.get())
                    self.endpoint = policy
                    self.createWeb(policy, lease: current)
                } catch {
                    Self.runtime.stop(current); self.lease = 0; self.endpoint = nil
                    self.showStatus("Não foi possível iniciar o nó neste dispositivo.", retry: true)
                }
            }
        })
    }

    func stopForBackground() {
        guard foreground || lease != 0 else { return }
        foreground = false
        let prior = lease; lease = 0; endpoint = nil; microphonePrompt = false
        finishMediaDecision(.deny)
        if presentedViewController is UIAlertController { dismiss(animated: false) }
        disposeWeb()
        // iOS grants only a bounded completion interval, never continuous relay.
        if backgroundTask == .invalid {
            backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Close local RelayLoom core") { [weak self] in self?.finishBackgroundTask() }
        }
        Self.runtime.stop(prior) { [weak self] in DispatchQueue.main.async { self?.finishBackgroundTask() } }
    }

    private func finishBackgroundTask() {
        if backgroundTask != .invalid { UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid }
    }

    private func disposeWeb() {
        if let web {
            web.stopLoading()
            web.pauseAllMediaPlayback(completionHandler: nil)
            web.closeAllMediaPresentations(completionHandler: nil)
            web.navigationDelegate = nil; web.uiDelegate = nil
            web.removeFromSuperview(); self.web = nil
        }
        if let identifier = rulesIdentifier {
            WKContentRuleListStore.default().removeContentRuleList(forIdentifier: identifier) { _ in }
            rulesIdentifier = nil
        }
    }

    private func createWeb(_ policy: OriginPolicy, lease current: UInt64) {
        let identifier = "relayloom-" + UUID().uuidString
        rulesIdentifier = identifier
        do {
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: try policy.resourceRules()) { [weak self] rules, error in
                DispatchQueue.main.async {
                    guard let self, self.foreground, Self.runtime.isCurrent(current), self.lease == current else {
                        WKContentRuleListStore.default().removeContentRuleList(forIdentifier: identifier) { _ in }; return
                    }
                    guard let rules, error == nil else {
                        Self.runtime.stop(current); self.lease = 0; self.endpoint = nil
                        self.showStatus("Não foi possível activar o isolamento da interface.", retry: true); return
                    }
                    let configuration = WKWebViewConfiguration()
                    configuration.websiteDataStore = .nonPersistent()
                    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
                    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
                    configuration.allowsInlineMediaPlayback = true
                    configuration.mediaTypesRequiringUserActionForPlayback = .all
                    configuration.userContentController.add(rules)
                    let web = WKWebView(frame: .zero, configuration: configuration)
                    if #available(iOS 16.4, *) { web.isInspectable = false }
                    web.navigationDelegate = self; web.uiDelegate = self
                    web.translatesAutoresizingMaskIntoConstraints = false
                    self.view.subviews.forEach { $0.removeFromSuperview() }
                    self.view.addSubview(web)
                    NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: self.view.leadingAnchor), web.trailingAnchor.constraint(equalTo: self.view.trailingAnchor), web.topAnchor.constraint(equalTo: self.view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: self.view.safeAreaLayoutGuide.bottomAnchor)])
                    self.web = web; web.load(URLRequest(url: policy.launchURL))
                }
            }
        } catch { Self.runtime.stop(current); lease = 0; endpoint = nil; showStatus("Sessão local inválida.", retry: true) }
    }

    private func trusted(_ candidate: WKWebView) -> Bool { foreground && candidate === web && Self.runtime.isCurrent(lease) && endpoint != nil }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if trusted(webView) && action.shouldPerformDownload {
            decisionHandler(.cancel)
            if presentedViewController == nil {
                let alert = UIAlertController(title: "Guardar ficheiro indisponível", message: "A exportação de ficheiros ainda não está implementada nesta versão iOS. Nenhum ficheiro foi guardado.", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "Compreendi", style: .default))
                present(alert, animated: true)
            }
            return
        }
        guard trusted(webView), action.targetFrame?.isMainFrame == true, endpoint?.navigation(action.request.url) == true, !action.shouldPerformDownload else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard trusted(webView), response.isForMainFrame, endpoint?.navigation(response.response.url) == true, response.canShowMIMEType else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) { completionHandler(.cancelAuthenticationChallenge, nil) }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if trusted(webView) { stopForBackground(); foreground = true; showStatus("A interface parou. Podes reiniciar o nó local.", retry: true) } }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard trusted(webView), let policy = endpoint, frame.isMainFrame,
              origin.protocol == "http", origin.host == "127.0.0.1", origin.port == (policy.origin.port ?? -1),
              type == .microphone, !microphonePrompt else { decisionHandler(.deny); return }
        let current = lease
        let request = OnceCompletion(decisionHandler)
        let requestID = request.id
        microphonePrompt = true
        pendingMediaDecision = request
        webView.evaluateJavaScript("navigator.userActivation.isActive") { [weak self] value, error in
            guard let self else { request.finish(.deny); return }
            guard error == nil, value as? Bool == true, self.trusted(webView), Self.runtime.isCurrent(current) else { self.finishMediaDecision(.deny, requestID: requestID); return }
            let alert = UIAlertController(title: "Gravar mensagem de voz", message: "Permitir o microfone para esta gravação? A câmara continua bloqueada.", preferredStyle: .alert)
            let finish: (Bool) -> Void = { [weak self] allow in
                guard let self else { request.finish(.deny); return }
                self.finishMediaDecision(allow && self.trusted(webView) && Self.runtime.isCurrent(current) ? .grant : .deny, requestID: requestID)
            }
            alert.addAction(UIAlertAction(title: "Não permitir", style: .cancel) { _ in finish(false) })
            alert.addAction(UIAlertAction(title: "Permitir microfone", style: .default) { _ in finish(true) })
            self.present(alert, animated: true)
        }
    }

    private func finishMediaDecision(_ decision: WKPermissionDecision, requestID: UUID? = nil) {
        if let requestID, pendingMediaDecision?.id != requestID { return }
        let completion = pendingMediaDecision
        pendingMediaDecision = nil
        microphonePrompt = false
        completion?.finish(decision)
    }

    private func showStatus(_ message: String, retry: Bool) {
        loadViewIfNeeded()
        view.subviews.forEach { $0.removeFromSuperview() }
        let panel = UIStackView(); panel.axis = .vertical; panel.alignment = .center; panel.spacing = 20; panel.translatesAutoresizingMaskIntoConstraints = false
        let label = UILabel(); label.numberOfLines = 0; label.textAlignment = .center; label.font = .preferredFont(forTextStyle: .headline); label.adjustsFontForContentSizeCategory = true; label.text = message
        panel.addArrangedSubview(label); status = label
        if retry { let button = UIButton(type: .system); button.setTitle("Tentar novamente", for: .normal); button.addTarget(self, action: #selector(retryStart), for: .touchUpInside); panel.addArrangedSubview(button) }
        else { let progress = UIActivityIndicatorView(style: .medium); progress.startAnimating(); panel.addArrangedSubview(progress) }
        let limits = UILabel(); limits.numberOfLines = 0; limits.textAlignment = .center; limits.font = .preferredFont(forTextStyle: .footnote); limits.adjustsFontForContentSizeCategory = true; limits.text = "Rede experimental. A retransmissão pára em segundo plano."; panel.addArrangedSubview(limits)
        view.addSubview(panel); NSLayoutConstraint.activate([panel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 28), panel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -28), panel.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
    }
    @objc private func retryStart() { startForeground() }
}
