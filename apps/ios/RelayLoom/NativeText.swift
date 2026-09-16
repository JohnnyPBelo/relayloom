import Foundation
import CoreFoundation
import Darwin

/// Read-only presentation hints, also available before the local core starts.
/// Never opens the identity vault or writes to the profile.
enum NativeText {
    static func text(_ source: String) -> String {
        let preferred = Locale.preferredLanguages
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return translate(source, language: fallback(preferred))
        }
        return translate(source, language: language(core: support.appendingPathComponent("RelayLoom/core", isDirectory: true), preferred: preferred))
    }

    static func fallback(_ preferred: [String]) -> String {
        for tag in preferred {
            let base = tag.lowercased().replacingOccurrences(of: "_", with: "-").split(separator: "-").first
            switch base {
            case "pt": return "pt-PT"
            case "en": return "en-GB"
            case "es": return "es-ES"
            default: continue
            }
        }
        return "en-GB"
    }

    static func language(core: URL, preferred: [String]) -> String {
        let defaultLanguage = fallback(preferred)
        // System container paths may contain aliases. Resolve the app parent,
        // then reject a symlink in either the core entry or preference file.
        let directory = core.deletingLastPathComponent().resolvingSymlinksInPath().appendingPathComponent(core.lastPathComponent, isDirectory: true)
        var info = stat()
        guard lstat(directory.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR else { return defaultLanguage }
        let fd = open(directory.appendingPathComponent("ui-preferences.json").path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard fd >= 0 else { return defaultLanguage }
        defer { _ = close(fd) }
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size <= 4096 else { return defaultLanguage }
        var buffer = [UInt8](repeating: 0, count: 4097)
        let count: Int = buffer.withUnsafeMutableBytes { pointer in
            var count = 0
            while count < pointer.count {
                let next = Darwin.read(fd, pointer.baseAddress!.advanced(by: count), pointer.count - count)
                if next < 0 { return -1 }
                if next == 0 { break }
                count += next
            }
            return count
        }
        guard count > 0, count <= 4096 else { return defaultLanguage }
        let bytes = Data(buffer.prefix(count))
        guard String(data: bytes, encoding: .utf8) != nil,
              let record = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(record.keys) == Set(["version", "values"]),
              let version = record["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
              let values = record["values"] as? [String: Any] else { return defaultLanguage }
        for (key, value) in values {
            switch key {
            case "language":
                guard let string = value as? String, ["pt-PT", "en-GB", "es-ES"].contains(string) else { return defaultLanguage }
            case "theme":
                guard let string = value as? String, ["light", "dark"].contains(string) else { return defaultLanguage }
            case "glass", "largeText", "highContrast":
                guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return defaultLanguage }
            default: return defaultLanguage
            }
        }
        return values["language"] as? String ?? defaultLanguage
    }

    static func translate(_ source: String, language: String) -> String {
        guard let pair = strings[source] else { return source }
        switch language {
        case "en-GB": return pair.0
        case "es-ES": return pair.1
        default: return source
        }
    }

    private static let strings: [String: (String, String)] = [
        "A preparar o teu nó neste dispositivo…": ("Preparing your node on this device…", "Preparando tu nodo en este dispositivo…"),
        "A iniciar a rede neste dispositivo…": ("Starting the network on this device…", "Iniciando la red en este dispositivo…"),
        "Não foi possível iniciar o nó neste dispositivo.": ("Could not start the node on this device.", "No se ha podido iniciar el nodo en este dispositivo."),
        "Não foi possível activar o isolamento da interface.": ("Could not activate interface isolation.", "No se ha podido activar el aislamiento de la interfaz."),
        "Sessão local inválida.": ("Invalid local session.", "Sesión local no válida."),
        "A interface parou. Podes reiniciar o nó local.": ("The interface stopped. You can restart the local node.", "La interfaz se ha detenido. Puedes reiniciar el nodo local."),
        "Tentar novamente": ("Try again", "Volver a intentar"),
        "Rede experimental. A retransmissão pára em segundo plano.": ("Experimental network. Relaying stops in the background.", "Red experimental. La retransmisión se detiene en segundo plano."),
        "Ocultar teclado": ("Hide keyboard", "Ocultar teclado"),
        "Termina a escrita sem enviar o formulário.": ("Finish typing without submitting the form.", "Termina de escribir sin enviar el formulario."),
        "Guardar ficheiro indisponível": ("Saving files is unavailable", "Guardar archivos no está disponible"),
        "A exportação de ficheiros ainda não está implementada nesta versão iOS. Nenhum ficheiro foi guardado.": ("File export is not yet implemented in this iOS version. No file was saved.", "La exportación de archivos aún no está implementada en esta versión iOS. No se ha guardado ningún archivo."),
        "Gravar mensagem de voz": ("Record a voice message", "Grabar un mensaje de voz"),
        "Permitir o microfone para esta gravação? A câmara continua bloqueada.": ("Allow the microphone for this recording? The camera remains blocked.", "¿Permitir el micrófono para esta grabación? La cámara permanece bloqueada."),
        "Não permitir": ("Don't allow", "No permitir"),
        "Permitir microfone": ("Allow microphone", "Permitir micrófono"),
        "Compreendi": ("Understood", "Entendido")
    ]
}
