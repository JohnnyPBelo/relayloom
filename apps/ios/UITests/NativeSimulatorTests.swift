import XCTest
import Foundation

private struct SimulatorFixtures: Decodable {
    let runID: String
    let senderName: String
    let passphrase: String
    let recipientName: String
    let recipientCard: String
    let message: String
    let post: String
    let attachmentMessage: String
    let photoAttachment: Bool
    let peerTCPPort: Int
    let reply: String
}

private enum SmokeFailure: Error, LocalizedError {
    case missing(String)
    var errorDescription: String? {
        switch self { case .missing(let label): return "Simulator UI checkpoint unavailable: \(label)" }
    }
}

/// Exercises the shipped WKWebView/Go application with accessibility input.
/// No app API, capability, JavaScript injection, debugging or private app hook.
final class NativeSimulatorTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor
    func testNativeCoreUIAndRecovery() throws {
        let bundle = Bundle(for: NativeSimulatorTests.self)
        let url = try XCTUnwrap(bundle.url(forResource: "run-fixtures", withExtension: "json"))
        let fixtures = try JSONDecoder().decode(SimulatorFixtures.self, from: Data(contentsOf: url))
        XCTAssertLessThan(fixtures.recipientCard.utf8.count, 2048)
        let app = XCUIApplication(bundleIdentifier: "org.relayloom.ios")
        // Locale overrides apply only to this test application process. The
        // shared web UI remains Portuguese; Apple picker buttons use English.
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        do {
            try require(app.webViews.firstMatch, "WKWebView startup", timeout: 45)
        } catch {
            // Preserve the owned app's native startup status before teardown.
            // The previous failure terminated it before any capture was kept.
            if app.state == .runningForeground { capture(app, "relayloom-00-startup-failed") }
            throw error
        }
        try require(app.webViews.buttons["Criar identidade"].firstMatch, "new identity form")
        capture(app, "relayloom-01-onboarding")

        let name = app.webViews.textFields.firstMatch
        try require(name, "identity name"); name.tap(); name.typeText(fixtures.senderName)
        let secret = app.webViews.secureTextFields.firstMatch
        try require(secret, "identity passphrase"); secret.tap(); secret.typeText(fixtures.passphrase)
        try dismissKeyboard(app, anchor: "Um novo fio na rede.")
        try tap(app, "Criar identidade")
        try require(app.webViews.buttons["Nova conversa"].firstMatch, "identity created by UI", timeout: 45)
        print("IOS_SIMULATOR_PHASE identity-created")

        try navigate(app, to: "A praça")
        try tap(app, "Partilhar algo")
        let post = app.webViews.textViews.firstMatch
        try require(post, "post composer"); post.tap(); post.typeText(fixtures.post)
        try dismissKeyboard(app, anchor: "Uma história para partilhar")
        try tap(app, "Publicar")
        try vanished(app.webViews.buttons["Publicar"].firstMatch, "post form completed")
        try require(app.webViews.staticTexts[fixtures.post].firstMatch, "signed post visible")
        print("IOS_SIMULATOR_PHASE post-published")

        try navigate(app, to: "Conversas")
        try tap(app, "Adicionar contacto")
        let card = app.webViews.textViews.firstMatch
        try require(card, "recipient card field"); card.tap(); card.typeText(fixtures.recipientCard)
        try dismissKeyboard(app, anchor: "Adicionar uma pessoa")
        try tap(app, "Verificar e adicionar")
        try vanished(app.webViews.buttons["Verificar e adicionar"].firstMatch, "contact form completed")

        try navigate(app, to: "A rede")
        try tap(app, "Ligar um par")
        let port = app.webViews.textFields.element(boundBy: 1)
        try require(port, "synthetic peer TCP port"); port.tap(); port.typeText(String(fixtures.peerTCPPort))
        try dismissKeyboard(app, anchor: "Ligar um par")
        try tap(app, "Ligar por TCP")
        try vanished(app.webViews.buttons["Ligar por TCP"].firstMatch, "peer form completed")
        try navigate(app, to: "Conversas")
        try tap(app, "Nova conversa")
        try chooseRecipient(app, name: fixtures.recipientName)
        try send(app, text: fixtures.message)
        capture(app, "relayloom-02-private-message")
        print("IOS_SIMULATOR_PHASE private-message-saved")

        if fixtures.photoAttachment {
            try attachPhoto(app)
            try send(app, text: fixtures.attachmentMessage)
            // The attachment must materialize from the native /attachment path,
            // not merely remain selected in the local composer.
            let attachmentLink = app.webViews.links.matching(NSPredicate(format: "label MATCHES[c] %@", ".*\\.(png|jpe?g|heic|heif).*")).firstMatch
            try require(attachmentLink, "stored photo attachment link", timeout: 30)
            capture(app, "relayloom-03-photo-attachment")
            print("IOS_SIMULATOR_PHASE photo-attachment-saved")
        }

        try require(app.webViews.staticTexts[fixtures.reply].firstMatch, "real Node peer reply", timeout: 60)
        capture(app, "relayloom-03b-node-peer-reply")
        print("IOS_SIMULATOR_PHASE node-peer-reply-read")

        XCUIDevice.shared.press(.home)
        let backgrounded = NSPredicate { _, _ in app.state == .runningBackground || app.state == .notRunning }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: backgrounded, object: nil)], timeout: 15), .completed)
        // Permit the host's bounded asynchronous Go shutdown to finish.
        Thread.sleep(forTimeInterval: 3)
        app.activate()
        try unlock(app, fixtures: fixtures)
        try chooseRecipient(app, name: fixtures.recipientName)
        try require(app.webViews.staticTexts[fixtures.message].firstMatch, "message survives background/resume")
        try require(app.webViews.staticTexts[fixtures.reply].firstMatch, "Node reply survives background/resume")
        if fixtures.photoAttachment { try require(app.webViews.staticTexts[fixtures.attachmentMessage].firstMatch, "attachment message survives resume") }
        capture(app, "relayloom-04-after-resume")
        print("IOS_SIMULATOR_PHASE background-resume-recovered")

        app.terminate()
        app.launch()
        try unlock(app, fixtures: fixtures)
        try chooseRecipient(app, name: fixtures.recipientName)
        try require(app.webViews.staticTexts[fixtures.message].firstMatch, "message survives process relaunch")
        try require(app.webViews.staticTexts[fixtures.reply].firstMatch, "Node reply survives process relaunch")
        if fixtures.photoAttachment { try require(app.webViews.staticTexts[fixtures.attachmentMessage].firstMatch, "attachment survives process relaunch") }
        capture(app, "relayloom-05-after-relaunch")
        try navigate(app, to: "A praça")
        try require(app.webViews.staticTexts[fixtures.post].firstMatch, "post survives process relaunch")
        print("IOS_SIMULATOR_PHASE process-relaunch-recovered")

        let report: [String: Any] = ["kind": "IOS_REAL_SIMULATOR_UI", "runID": fixtures.runID, "identityCreatedViaUI": true, "postCreatedViaUI": true, "privateMessageCreatedViaUI": true, "photoSelectedViaSystemPicker": fixtures.photoAttachment, "nodePeerConnectedViaUI": true, "nodeReplyReadViaUI": true, "backgroundResumeRequiresUnlock": true, "processRelaunchRequiresUnlock": true, "restoredContentsVisible": true, "appAPIOrCapabilityAccess": false, "javascriptInjection": false]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "relayloom-ui-checks"; attachment.lifetime = .keepAlways; add(attachment)
        print("IOS_SIMULATOR_PHASE completed")
    }

    @MainActor private func require(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 30) throws {
        guard element.waitForExistence(timeout: timeout) else { throw SmokeFailure.missing(label) }
    }
    @MainActor private func tap(_ app: XCUIApplication, _ label: String) throws {
        let element = app.webViews.buttons.matching(identifier: label).firstMatch
        try require(element, label); element.tap()
    }
    @MainActor private func vanished(_ element: XCUIElement, _ label: String) throws {
        let absent = NSPredicate { _, _ in !element.exists }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: absent, object: nil)], timeout: 30) == .completed else { throw SmokeFailure.missing(label) }
    }
    @MainActor private func navigate(_ app: XCUIApplication, to label: String) throws {
        let destination = app.webViews.buttons.matching(identifier: label).firstMatch
        if !destination.isHittable { try tap(app, "Abrir navegação") }
        try require(destination, "navigation " + label); destination.tap()
    }
    @MainActor private func chooseRecipient(_ app: XCUIApplication, name: String) throws {
        let recipient = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        try require(recipient, "synthetic recipient conversation"); recipient.tap()
        try require(app.webViews.textViews["Escrever mensagem"].firstMatch, "private message composer")
    }
    @MainActor private func send(_ app: XCUIApplication, text: String) throws {
        let composer = app.webViews.textViews["Escrever mensagem"].firstMatch
        try require(composer, "message composer"); composer.tap(); composer.typeText(text)
        try tap(app, "Enviar mensagem")
        try require(app.webViews.staticTexts[text].firstMatch, "saved message visible")
        // Tapping the fixed privacy note blurs the composer without a host hook.
        try dismissKeyboard(app, anchor: "Uma ligação só vossa")
    }
    @MainActor private func unlock(_ app: XCUIApplication, fixtures: SimulatorFixtures) throws {
        try require(app.webViews.buttons["Entrar na minha rede"].firstMatch, "persisted identity is locked", timeout: 45)
        XCTAssertFalse(app.webViews.buttons["Criar identidade"].firstMatch.exists)
        let secret = app.webViews.secureTextFields.firstMatch
        try require(secret, "unlock passphrase"); secret.tap(); secret.typeText(fixtures.passphrase)
        try dismissKeyboard(app, anchor: "Bom ter-te de volta.")
        try tap(app, "Entrar na minha rede")
        try require(app.webViews.buttons["Nova conversa"].firstMatch, "recovered native identity", timeout: 45)
    }
    @MainActor private func dismissKeyboard(_ app: XCUIApplication, anchor: String) throws {
        guard app.keyboards.firstMatch.exists else { return }
        let done = app.toolbars.buttons["Done"].firstMatch
        if done.exists && done.isHittable { done.tap(); return }
        let text = app.webViews.staticTexts[anchor].firstMatch
        if text.exists && text.isHittable { text.tap() }
    }
    @MainActor private func attachPhoto(_ app: XCUIApplication) throws {
        let controls = app.webViews.descendants(matching: .any).matching(identifier: "Anexar ficheiro")
        guard let control = controls.allElementsBoundByIndex.first(where: { $0.isHittable }) else { throw SmokeFailure.missing("file input") }
        control.tap()
        let library = app.buttons["Photo Library"].firstMatch
        try require(library, "system Photo Library action", timeout: 15); library.tap()
        let photo = app.collectionViews.cells.firstMatch
        try require(photo, "seeded synthetic photo", timeout: 20); photo.tap()
        let add = app.buttons.matching(NSPredicate(format: "label == 'Add' OR label BEGINSWITH 'Add (' OR label == 'Done' OR label == 'Choose'")).firstMatch
        try require(add, "confirm system photo selection", timeout: 15); add.tap()
        try require(app.webViews.buttons["Remover"].firstMatch, "photo selected into composer", timeout: 20)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
