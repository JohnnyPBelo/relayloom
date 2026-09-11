import Foundation

@main
enum PolicyTests {
    static func main() throws {
        var assertions = 0
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
        check(rules.count == 4, "Resource isolation rule set exists")

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
        print("iOS policy: \(assertions) assertions passed (host Swift/Foundation; fake runtime backend; no iOS device or WKWebView execution)")
    }
}
