import Foundation
import WebKit

private final class RuleCompilationResult {
    private let lock = NSLock()
    private var result: (compiled: Bool, error: String)?
    func finish(_ rules: WKContentRuleList?, _ error: Error?) {
        lock.lock(); defer { lock.unlock() }
        result = (rules != nil, error.map { "\(($0 as NSError).domain):\(($0 as NSError).code)" } ?? "")
    }
    func snapshot() -> (compiled: Bool, error: String)? {
        lock.lock(); defer { lock.unlock() }
        return result
    }
}

/// This invokes the actual macOS WebKit parser; Foundation regex matching
/// alone cannot detect unsupported content-blocker syntax. No WKWebView UI,
/// remote request, default user cache, simulator or app safety override is used.
@MainActor private func compileRules(_ json: String, store: WKContentRuleListStore, label: String) -> (compiled: Bool, error: String) {
    let result = RuleCompilationResult()
    store.compileContentRuleList(forIdentifier: "relayloom-policy-" + UUID().uuidString, encodedContentRuleList: json) { rules, error in result.finish(rules, error) }
    let deadline = Date().addingTimeInterval(15)
    while result.snapshot() == nil && Date() < deadline {
        _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
    guard let completed = result.snapshot() else { fatalError("WebKit rule compiler timed out: \(label)") }
    print("WebKit rule compiler \(label): compiled=\(completed.compiled), error=\(completed.error)")
    return completed
}

@main
enum PolicyTests {
    @MainActor static func main() throws {
        var assertions = 0
        let languageAssertions = try NativeTextTests.run()
        print("Native language preferences: \(languageAssertions) assertions passed (macOS host; no iOS UI execution)")
        func check(_ value: Bool, _ label: String) {
            assertions += 1
            if !value { fatalError(label) }
        }
        let token = String(repeating: "a", count: 64)
        func endpoint(_ origin: String, _ candidateToken: String = String(repeating: "a", count: 64)) -> String {
            String(data: try! JSONSerialization.data(withJSONObject: ["origin": origin, "token": candidateToken, "tcpPort": 42000]), encoding: .utf8)!
        }
        let policy = try OriginPolicy(response: endpoint("http://127.0.0.1:41000"))
        check(policy.sameOrigin(URL(string: "http://127.0.0.1:41000/api/state")), "Exact local API origin")
        check(policy.navigation(policy.launchURL), "Launch URL accepted")
        check(policy.launchURL.fragment == "token=" + token, "Capability retained in fragment")
        for raw in ["https://example.org/", "http://localhost:41000/", "http://127.0.0.1:41001/", "http://127.0.0.1.evil:41000/", "http://user@127.0.0.1:41000/", "file:///private/key", "javascript:alert(1)", "data:text/html,x"] {
            check(!policy.sameOrigin(URL(string: raw)), "Reject other origin/scheme")
        }
        check(!policy.navigation(URL(string: "http://127.0.0.1:41000/api/state")), "API is not top-level app page")
        check(!policy.navigation(URL(string: "http://127.0.0.1:41000/?redirect=x")), "Query navigation denied")
        for raw in ["http://0.0.0.0:41000", "http://127.0.0.1:0", "https://127.0.0.1:41000", "http://127.0.0.1:41000/path"] {
            do { _ = try OriginPolicy(response: endpoint(raw)); check(false, "Invalid bootstrap accepted") } catch { check(true, "Invalid bootstrap rejected") }
        }
        do { _ = try OriginPolicy(response: endpoint("http://127.0.0.1:41000", "short")); check(false, "Short token accepted") } catch { check(true, "Short token rejected") }
        let rules = try JSONSerialization.jsonObject(with: policy.resourceRules().data(using: .utf8)!) as! [[String: Any]]
        check(rules.count == 5, "Resource isolation rule set exists")

        // Match the documented action ordering for a semantic boundary matrix.
        // The actual WebKit compiler below is a separate positive/negative gate.
        func resourceAllowed(_ raw: String, type: String) throws -> Bool {
            var allowed = true
            for rule in rules {
                let trigger = rule["trigger"] as! [String: Any]
                if let types = trigger["resource-type"] as? [String], !types.contains(type) { continue }
                let filter = try NSRegularExpression(pattern: trigger["url-filter"] as! String, options: .caseInsensitive)
                if filter.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)) == nil { continue }
                let action = (rule["action"] as! [String: String])["type"]!
                allowed = action == "ignore-previous-rules"
            }
            return allowed
        }
        for raw in ["http://127.0.0.1:41000", "http://127.0.0.1:41000/", "http://127.0.0.1:41000/assets/app.js", "http://127.0.0.1:41000/api/state?cursor=1"] {
            check(try resourceAllowed(raw, type: "raw"), "Only exact origin resources allowed")
        }
        for raw in ["https://127.0.0.1:41000/", "http://localhost:41000/", "http://127.0.0.1:41001/", "http://127.0.0.1:410000/", "http://127.0.0.1:41000.evil/", "http://127x0x0x1:41000/", "http://127.0.0.1:41000@evil.test/", "https://example.org/font.woff", "file:///private/key"] {
            check(try !resourceAllowed(raw, type: "raw"), "Other origins remain blocked")
        }
        check(try resourceAllowed("blob:http://127.0.0.1:41000/fixture", type: "media"), "Local blob media preserved")
        check(try !resourceAllowed("blob:http://127.0.0.1:41001/fixture", type: "image"), "Other-origin blob blocked")
        check(try !resourceAllowed("blob:http://127.0.0.1:41000/fixture", type: "script"), "Blob scripts blocked")
        check(try resourceAllowed("data:image/png;base64,AA==", type: "image"), "Inline images preserved")
        check(try !resourceAllowed("data:text/javascript,alert(1)", type: "script"), "Data scripts blocked")

        let cache = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(".cache/ios/content-rules-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: cache) }
        guard let store = (WKContentRuleListStore(url: cache) as WKContentRuleListStore?) else { fatalError("Project-scoped WebKit rule store unavailable") }
        let accepted = compileRules(try policy.resourceRules(), store: store, label: "current-policy")
        check(accepted.compiled && accepted.error.isEmpty, "Actual WebKit accepts exact-origin rules")
        var legacy = rules
        legacy.remove(at: 2)
        legacy[1]["trigger"] = ["url-filter": "^\(NSRegularExpression.escapedPattern(for: policy.origin.absoluteString))(/|$)"]
        let legacyJSON = String(data: try JSONSerialization.data(withJSONObject: legacy), encoding: .utf8)!
        let rejected = compileRules(legacyJSON, store: store, label: "legacy-invalid-anchor-control")
        check(!rejected.compiled && !rejected.error.isEmpty, "Actual WebKit rejects the earlier invalid expression")

        final class FakeBackend: RuntimeBackend {
            var active: String?
            func start(data: String, assets: String) throws -> String { active = data; return data }
            func stop() throws { active = nil }
        }
        let backend = FakeBackend(), coordinator = RuntimeCoordinator(backend: FakeBackend())
        let actual = RuntimeCoordinator(backend: backend)
        let old = actual.start(prepare: { ("old", "assets") }, completion: { _, _ in }); actual.drainForTest()
        let replacement = actual.start(prepare: { ("replacement", "assets") }, completion: { _, _ in }); actual.drainForTest()
        actual.stop(old); actual.drainForTest()
        check(backend.active == "replacement", "Stale stop preserves replacement")
        check(actual.isCurrent(replacement) && !actual.isCurrent(old), "Only current lease owns runtime")
        actual.stop(replacement); actual.drainForTest(); check(backend.active == nil, "Owner stops runtime")
        let cancelled = coordinator.start(prepare: { ("cancelled", "assets") }, completion: { _, _ in }); coordinator.stop(cancelled); coordinator.drainForTest()
        check(!coordinator.isCurrent(cancelled), "Cancelled lease revoked")
        var oldAnswers: [Bool] = [], newAnswers: [Bool] = []
        let oldPermission = OnceCompletion<Bool> { oldAnswers.append($0) }
        oldPermission.finish(false)
        let newPermission = OnceCompletion<Bool> { newAnswers.append($0) }
        oldPermission.finish(true) // Delayed callback after replacement.
        check(oldAnswers == [false] && newAnswers.isEmpty, "Old permission resolves once and cannot consume replacement")
        newPermission.finish(true); newPermission.finish(false)
        check(newAnswers == [true], "New permission resolves exactly once")
        print("iOS policy: \(assertions) assertions passed (macOS Swift/Foundation and actual WebKit rule compilation; fake runtime backend; no iOS device or WKWebView UI execution)")
    }
}
