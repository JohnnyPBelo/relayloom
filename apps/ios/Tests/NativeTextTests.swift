import Foundation
import Darwin

enum NativeTextTests {
    static func run() throws -> Int {
        var assertions = 0
        func check(_ value: Bool, _ label: String) {
            assertions += 1
            if !value { fatalError(label) }
        }
        check(NativeText.fallback(["fr-FR", "es-MX"]) == "es-ES", "First supported OS language")
        check(NativeText.fallback(["pt_BR", "en-US"]) == "pt-PT", "Portuguese variants")
        check(NativeText.fallback(["en-US", "es-ES"]) == "en-GB", "English variants")
        check(NativeText.fallback(["fr-FR"]) == "pt-PT", "Unsupported OS fallback")
        check(NativeText.translate("Ocultar teclado", language: "en-GB") == "Hide keyboard", "English keyboard label")
        check(NativeText.translate("Tentar novamente", language: "es-ES") == "Volver a intentar", "Spanish native retry")
        check(NativeText.translate("A iniciar a rede neste dispositivo…", language: "pt-PT") == "A iniciar a rede neste dispositivo…", "Portuguese native source")
        check(NativeText.translate("My own words", language: "pt-PT") == "My own words", "Unknown content is not rewritten")
        let directory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(".cache/ios/language-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("ui-preferences.json")
        func read(_ core: URL? = nil) -> String { NativeText.language(core: core ?? directory, preferred: ["en-US"]) }
        func write(_ json: String) throws { try Data(json.utf8).write(to: file) }
        check(read() == "en-GB", "Missing file uses OS language")
        for language in ["pt-PT", "en-GB", "es-ES"] {
            try write("{\"version\":1,\"values\":{\"language\":\"\(language)\",\"theme\":\"dark\",\"glass\":true,\"largeText\":false,\"highContrast\":true}}")
            check(read() == language, "Saved choice takes precedence")
        }
        let invalid = ["", "{", "[]", "{}", "{\"version\":2,\"values\":{\"language\":\"es-ES\"}}", "{\"version\":true,\"values\":{\"language\":\"es-ES\"}}", "{\"version\":\"1\",\"values\":{\"language\":\"es-ES\"}}", "{\"values\":{\"language\":\"es-ES\"}}", "{\"version\":1,\"values\":{\"language\":\"es-ES\"},\"unknown\":true}", "{\"version\":1,\"values\":{\"language\":\"es-ES\",\"unknown\":true}}", "{\"version\":1,\"values\":{\"language\":\"es-ES\",\"glass\":1}}", "{\"version\":1,\"values\":{\"language\":\"es-ES\",\"theme\":\"auto\"}}", "{\"version\":1,\"values\":{\"language\":\"fr-FR\"}}", "{\"version\":1,\"values\":{\"language\":false}}", "{\"version\":1,\"values\":null}", "{\"version\":1,\"values\":{\"language\":\"es-ES\"}} {}"]
        for (index, json) in invalid.enumerated() {
            try write(json); check(read() == "en-GB", "Invalid preference control \(index)")
        }
        let valid = "{\"version\":1,\"values\":{\"language\":\"es-ES\"}}"
        try write(valid + String(repeating: " ", count: 4096 - valid.utf8.count))
        check(read() == "es-ES", "Exact byte bound")
        try write(valid + String(repeating: " ", count: 4097 - valid.utf8.count))
        check(read() == "en-GB", "Oversized file refused")
        try Data([0xc3, 0x28]).write(to: file)
        check(read() == "en-GB", "Invalid UTF-8 refused")
        try FileManager.default.removeItem(at: file)
        let target = directory.appendingPathComponent("target.json")
        try Data(valid.utf8).write(to: target)
        try FileManager.default.createSymbolicLink(at: file, withDestinationURL: target)
        check(read() == "en-GB", "Preference symlink refused")
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        check(read() == "en-GB", "Non-file preference refused")
        try FileManager.default.removeItem(at: file)
        check(mkfifo(file.path, 0o600) == 0, "Private FIFO fixture exists")
        check(read() == "en-GB", "FIFO refused without blocking")
        try FileManager.default.removeItem(at: file); try write(valid)
        let link = directory.appendingPathComponent("core-link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: directory)
        check(read(link) == "en-GB", "Profile symlink refused")
        return assertions
    }
}
