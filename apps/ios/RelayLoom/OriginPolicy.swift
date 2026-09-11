import Foundation

/// A launch capability belongs only to this app's in-process loopback core.
struct OriginPolicy {
    let origin: URL
    let token: String
    let tcpPort: Int

    init(response: String) throws {
        guard let data = response.data(using: .utf8), data.count <= 4096,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raw = object["origin"] as? String,
              let parts = URLComponents(string: raw),
              parts.scheme == "http", parts.host == "127.0.0.1",
              let port = parts.port, (1...65535).contains(port),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              let token = object["token"] as? String,
              token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              let tcpPort = object["tcpPort"] as? Int, (1...65535).contains(tcpPort),
              let origin = URL(string: "http://127.0.0.1:\(port)") else {
            throw RuntimeFailure.invalidEndpoint
        }
        self.origin = origin
        self.token = token
        self.tcpPort = tcpPort
    }

    func sameOrigin(_ url: URL?) -> Bool {
        guard let url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme == "http" && parts.host == "127.0.0.1" && parts.port == origin.port && parts.user == nil && parts.password == nil
    }

    func navigation(_ url: URL?) -> Bool {
        guard sameOrigin(url), let url else { return false }
        return (url.path.isEmpty || url.path == "/") && url.query == nil
    }

    var launchURL: URL {
        var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        parts.path = "/"
        parts.fragment = "token=\(token)"
        return parts.url!
    }

    /// WebKit content rules also constrain resources, not only top navigation.
    func resourceRules() throws -> String {
        let escaped = NSRegularExpression.escapedPattern(for: origin.absoluteString)
        let rules: [[String: Any]] = [
            ["trigger": ["url-filter": ".*"], "action": ["type": "block"]],
            ["trigger": ["url-filter": "^\(escaped)(/|$)"], "action": ["type": "ignore-previous-rules"]],
            ["trigger": ["url-filter": "^blob:\(escaped)/", "resource-type": ["image", "media"]], "action": ["type": "ignore-previous-rules"]],
            ["trigger": ["url-filter": "^data:", "resource-type": ["image", "media"]], "action": ["type": "ignore-previous-rules"]],
        ]
        return String(data: try JSONSerialization.data(withJSONObject: rules), encoding: .utf8)!
    }
}

enum RuntimeFailure: Error, LocalizedError {
    case invalidEndpoint, unavailableAssets, nativeFailure
    var errorDescription: String? {
        switch self {
        case .invalidEndpoint: return "O núcleo local devolveu uma sessão inválida."
        case .unavailableAssets: return "A interface local não está incluída nesta aplicação."
        case .nativeFailure: return "Não foi possível iniciar o núcleo neste dispositivo."
        }
    }
}
