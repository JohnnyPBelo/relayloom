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
    func testStartupBeforeMedia() throws {
        let app = launchOwnedApp()
        defer { app.terminate() }
        try requireStartup(app)
        try require(app.webViews.buttons["Criar identidade"].firstMatch, "new identity form")
        capture(app, "relayloom-00-startup-ready")
        print("IOS_SIMULATOR_PHASE app-startup-checked")
    }

    @MainActor private func launchOwnedApp() -> XCUIApplication {
        let app = XCUIApplication(bundleIdentifier: "org.relayloom.ios")
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    @MainActor private func requireStartup(_ app: XCUIApplication) throws {
        do {
            try require(app.webViews.firstMatch, "WKWebView startup", timeout: 45)
        } catch {
            if app.state == .runningForeground { capture(app, "relayloom-00-startup-failed") }
            throw error
        }
    }

    @MainActor
    func testNativeCoreUIAndRecovery() throws {
        let bundle = Bundle(for: NativeSimulatorTests.self)
        let url = try XCTUnwrap(bundle.url(forResource: "run-fixtures", withExtension: "json"))
        let fixtures = try JSONDecoder().decode(SimulatorFixtures.self, from: Data(contentsOf: url))
        XCTAssertLessThan(fixtures.recipientCard.utf8.count, 2048)
        // Locale overrides apply only to this test application process. The
        // shared web UI remains Portuguese; Apple picker buttons use English.
        let app = launchOwnedApp()
        var completed = false
        defer {
            if !completed && app.state == .runningForeground {
                capture(app, "relayloom-99-functional-failed")
                print(app.keyboards.firstMatch.exists ? "IOS_SIMULATOR_PHASE failure-keyboard-visible" : "IOS_SIMULATOR_PHASE failure-keyboard-hidden")
            }
            app.terminate()
        }
        try requireStartup(app)
        try require(app.webViews.buttons["Criar identidade"].firstMatch, "new identity form")
        capture(app, "relayloom-01-onboarding")

        let name = app.webViews.textFields.firstMatch
        try require(name, "identity name"); name.tap(); name.typeText(fixtures.senderName)
        let secret = app.webViews.secureTextFields.firstMatch
        try require(secret, "identity passphrase"); secret.tap(); secret.typeText(fixtures.passphrase)
        try dismissKeyboard(app, anchor: "Um novo fio na rede.")
        try tap(app, "Criar identidade")
        try require(app.webViews.buttons["Pesquisar e navegar"].firstMatch, "identity created by UI", timeout: 45)
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
        completed = true
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
        let composer = app.webViews.textViews["Escrever mensagem"].firstMatch
        let heading = app.webViews.staticTexts[name].firstMatch
        // A restored compact conversation hides the list. Verify its actual
        // recipient instead of requiring an unrelated, hidden list control.
        if composer.exists && composer.isHittable && heading.exists && heading.isHittable { return }
        let back = app.webViews.buttons["Voltar às conversas"].firstMatch
        if back.exists && back.isHittable { back.tap() }
        let recipient = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        try require(recipient, "synthetic recipient conversation"); recipient.tap()
        try require(composer, "private message composer")
        try require(heading, "selected recipient heading")
        XCTAssertTrue(heading.isHittable, "Expected recipient must be visible before composing")
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
        try require(app.webViews.buttons["Pesquisar e navegar"].firstMatch, "recovered native identity", timeout: 45)
    }
    @MainActor private func dismissKeyboard(_ app: XCUIApplication, anchor: String) throws {
        guard app.keyboards.firstMatch.exists else { return }
        do {
            let nativeDismiss = app.buttons["relayloom.hide-keyboard"]
            // The iOS input accessory can be a button or a key. These exact
            // semantic labels never select Return or submit the form.
            let labels = ["Done", "Hide keyboard", "Dismiss keyboard"] as NSArray
            let predicate = NSPredicate(format: "identifier IN[c] %@ OR label IN[c] %@", labels, labels)
            let candidates = app.buttons.matching(predicate).allElementsBoundByIndex + app.keys.matching(predicate).allElementsBoundByIndex
            if nativeDismiss.exists && nativeDismiss.isHittable {
                nativeDismiss.tap()
            } else if let done = candidates.first(where: { $0.isHittable }) {
                done.tap()
            } else {
                let text = app.webViews.staticTexts[anchor].firstMatch
                // Keyboard focus scrolled the onboarding title offscreen in
                // the observed CI capture. Use bounded native gestures to
                // reveal the existing anchor; never inject app JavaScript.
                for _ in 0..<3 {
                    if !app.keyboards.firstMatch.exists || (text.exists && text.isHittable) { break }
                    app.webViews.firstMatch.swipeDown()
                }
                if app.keyboards.firstMatch.exists {
                    guard text.exists && text.isHittable else { throw SmokeFailure.missing("keyboard dismiss control for " + anchor) }
                    text.tap()
                }
            }
            try vanished(app.keyboards.firstMatch, "keyboard dismissed for " + anchor)
            print("IOS_SIMULATOR_PHASE keyboard-dismissed")
        } catch {
            keyboardControlEvidence(app)
            throw error
        }
    }
    @MainActor private func keyboardControlEvidence(_ app: XCUIApplication) {
        // Owned synthetic fixture only. Record button/key metadata, never
        // field values, the app URL/capability, or a full AX debug dump.
        let controls = app.buttons.allElementsBoundByIndex + app.keys.allElementsBoundByIndex
        let rows = controls.filter { $0.isHittable }.prefix(32).map { element in
            ["type": String(describing: element.elementType), "identifier": String(element.identifier.prefix(160)), "label": String(element.label.prefix(160))]
        }
        if let data = try? JSONSerialization.data(withJSONObject: rows, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) {
            print("IOS_SIMULATOR_KEYBOARD_CONTROLS " + text)
        }
    }
    @MainActor private func attachPhoto(_ app: XCUIApplication) throws {
        let controls = app.webViews.descendants(matching: .any).matching(identifier: "Anexar ficheiro")
        guard let control = controls.allElementsBoundByIndex.first(where: { $0.isHittable }) else { throw SmokeFailure.missing("file input") }
        control.tap()
        // WKWebView's file menu follows the page language (pt), even when the
        // simulator UI is English. Both exact native labels have been observed.
        let library = app.buttons.matching(NSPredicate(format: "label == 'Photo Library' OR label == 'Fototeca'")).firstMatch
        try require(library, "system Photo Library action", timeout: 15); library.tap()
        let photo = app.collectionViews.cells.firstMatch
        try require(photo, "seeded synthetic photo", timeout: 20); photo.tap()
        let add = app.buttons.matching(NSPredicate(format: "label == 'Add' OR label BEGINSWITH 'Add (' OR label == 'Done' OR label == 'Choose' OR label == 'Adicionar' OR label BEGINSWITH 'Adicionar (' OR label == 'Concluído' OR label == 'Escolher'")).firstMatch
        try require(add, "confirm system photo selection", timeout: 15); add.tap()
        try require(app.webViews.buttons["Remover"].firstMatch, "photo selected into composer", timeout: 20)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
