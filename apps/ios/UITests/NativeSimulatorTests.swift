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
        try tap(app, "Get started")
        try require(app.webViews.buttons["Create identity"].firstMatch, "new identity form")
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
        // shared web UI follows English here; Apple picker buttons also use English.
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
        try tap(app, "Get started")
        try require(app.webViews.buttons["Create identity"].firstMatch, "new identity form")
        capture(app, "relayloom-01-onboarding")

        let name = app.webViews.textFields.firstMatch
        try require(name, "identity name"); name.tap(); name.typeText(fixtures.senderName)
        let secret = app.webViews.secureTextFields.firstMatch
        try require(secret, "identity passphrase"); secret.tap(); secret.typeText(fixtures.passphrase)
        try dismissKeyboard(app, anchor: "Your place in the network.")
        try tap(app, "Create identity")
        try require(app.webViews.buttons["Search and navigate"].firstMatch, "identity created by UI", timeout: 45)
        print("IOS_SIMULATOR_PHASE identity-created")

        try navigate(app, to: "Community")
        try tap(app, "Share something")
        let post = app.webViews.textViews.firstMatch
        try require(post, "post composer"); post.tap(); post.typeText(fixtures.post)
        try dismissKeyboard(app, anchor: "A story to share")
        try tap(app, "Publish")
        try vanished(app.webViews.buttons["Publish"].firstMatch, "post form completed")
        try require(app.webViews.staticTexts[fixtures.post].firstMatch, "signed post visible")
        print("IOS_SIMULATOR_PHASE post-published")

        try navigate(app, to: "Conversations")
        try tap(app, "Add contact")
        let card = app.webViews.textViews.firstMatch
        try require(card, "recipient card field"); card.tap(); card.typeText(fixtures.recipientCard)
        try dismissKeyboard(app, anchor: "Add a person")
        try tap(app, "Verify and add")
        try vanished(app.webViews.buttons["Verify and add"].firstMatch, "contact form completed")

        try navigate(app, to: "Network")
        try tap(app, "Connect a peer")
        let port = app.webViews.textFields.element(boundBy: 1)
        try require(port, "synthetic peer TCP port"); port.tap(); port.typeText(String(fixtures.peerTCPPort))
        try dismissKeyboard(app, anchor: "Connect a peer")
        try tap(app, "Connect via TCP")
        try vanished(app.webViews.buttons["Connect via TCP"].firstMatch, "peer form completed")
        try navigate(app, to: "Conversations")
        try tap(app, "New conversation")
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
        try navigate(app, to: "Community")
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
        func targets() -> [XCUIElement] {
            app.webViews.buttons.matching(identifier: label).allElementsBoundByIndex.filter { $0.exists && $0.isEnabled && $0.isHittable }
        }
        // Run35160603438 exposed a hittable named button but no matching DOM
        // landmark through XCTest. Resolve current visible controls after the
        // drawer/dock changes; never guess among multiple matching controls.
        if targets().isEmpty { try tap(app, "Open navigation") }
        let visible = NSPredicate { _, _ in targets().count == 1 }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: visible, object: nil)], timeout: 30) == .completed else {
            navigationEvidence(app, label: label, phase: "not-hittable")
            throw SmokeFailure.missing("one visible navigation control " + label)
        }
        let current = targets()
        guard current.count == 1 else { throw SmokeFailure.missing("stable navigation control " + label) }
        navigationEvidence(app, label: label, phase: "before-tap")
        current[0].tap()
        navigationEvidence(app, label: label, phase: "after-tap")
    }
    @MainActor private func navigationEvidence(_ app: XCUIApplication, label: String, phase: String) {
        // Only fixture navigation labels/geometry, never form values or cards.
        let candidates: [[String: Any]] = app.webViews.buttons.matching(identifier: label).allElementsBoundByIndex.prefix(6).map { element in
            let frame = element.frame
            return ["identifier": element.identifier, "label": element.label, "hittable": element.isHittable, "enabled": element.isEnabled,
                    "x": frame.origin.x, "y": frame.origin.y, "width": frame.width, "height": frame.height]
        }
        if let data = try? JSONSerialization.data(withJSONObject: ["phase": phase, "destination": label, "candidates": candidates], options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) { print("IOS_SIMULATOR_NAVIGATION " + text) }
    }
    @MainActor private func chooseRecipient(_ app: XCUIApplication, name: String) throws {
        let composer = app.webViews.textViews["Write a message"].firstMatch
        let heading = app.webViews.staticTexts[name].firstMatch
        // A restored compact conversation hides the list. Verify its actual
        // recipient instead of requiring an unrelated, hidden list control.
        if composer.exists && composer.isHittable && heading.exists && heading.isHittable { return }
        let back = app.webViews.buttons["Back to conversations"].firstMatch
        if back.exists && back.isHittable { back.tap() }
        let recipient = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        try require(recipient, "synthetic recipient conversation"); recipient.tap()
        try require(composer, "private message composer")
        try require(heading, "selected recipient heading")
        XCTAssertTrue(heading.isHittable, "Expected recipient must be visible before composing")
    }
    @MainActor private func send(_ app: XCUIApplication, text: String) throws {
        let composer = app.webViews.textViews["Write a message"].firstMatch
        try require(composer, "message composer"); composer.tap(); composer.typeText(text)
        try tap(app, "Send message")
        try require(app.webViews.staticTexts[text].firstMatch, "saved message visible")
        // Tapping the fixed privacy note blurs the composer without a host hook.
        try dismissKeyboard(app, anchor: "A connection of your own")
    }
    @MainActor private func unlock(_ app: XCUIApplication, fixtures: SimulatorFixtures) throws {
        try require(app.webViews.buttons["Enter my network"].firstMatch, "persisted identity is locked", timeout: 45)
        XCTAssertFalse(app.webViews.buttons["Create identity"].firstMatch.exists)
        let secret = app.webViews.secureTextFields.firstMatch
        try require(secret, "unlock passphrase"); secret.tap(); secret.typeText(fixtures.passphrase)
        try dismissKeyboard(app, anchor: "Welcome back.")
        try tap(app, "Enter my network")
        try require(app.webViews.buttons["Search and navigate"].firstMatch, "recovered native identity", timeout: 45)
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
                XCTAssertEqual(nativeDismiss.label, "Hide keyboard", "Native keyboard control follows the English app interface")
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
        let controls = app.webViews.descendants(matching: .any).matching(identifier: "Attach file")
        guard let control = controls.allElementsBoundByIndex.first(where: { $0.isHittable }) else { throw SmokeFailure.missing("file input") }
        control.tap()
        // WKWebView's file menu follows the page language (pt), even when the
        // simulator UI is English. Both exact native labels have been observed.
        let library = app.buttons.matching(NSPredicate(format: "label == 'Photo Library' OR label == 'Fototeca'")).firstMatch
        try require(library, "system Photo Library action", timeout: 15); library.tap()
        print("IOS_SIMULATOR_PHASE photo-picker-requested")
        // The picker may be hosted by a separate system process. Preserve the
        // owned simulator screen before an accessibility query can fail.
        let pickerScreen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        pickerScreen.name = "ios-photo-picker-before-cell-query"
        pickerScreen.lifetime = .keepAlways
        add(pickerScreen)
        // Run35786710953 exposes grid assets as PXGGridLayout-Info images,
        // not cells. Only the freshly imported fixture has a recent, yearless
        // timestamp; stock simulator images have historical years in their label.
        let banner = app.images["PickerOnboardingHeaderViewIcon"]
        if banner.exists && banner.isHittable {
            let close = app.buttons.matching(NSPredicate(format: "label == 'Close' OR label == 'Fechar'")).firstMatch
            if close.exists && close.isHittable { close.tap() }
        }
        let ready = NSPredicate { _, _ in self.photoCandidates(app).count == 1 }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 20) == .completed else {
            photoPickerEvidence(app)
            throw SmokeFailure.missing("seeded synthetic photo")
        }
        let candidates = photoCandidates(app)
        guard candidates.count == 1, let photo = candidates.first else {
            throw SmokeFailure.missing("one unambiguous synthetic photo")
        }
        photoPickerEvidence(app)
        print("IOS_SIMULATOR_PHASE photo-picker-ready")
        if photo.isHittable { photo.tap() }
        else {
            // The observed Info proxy has a real visible frame but no AX hit
            // point. Tap its measured centre, never a fixed screen coordinate.
            // Candidate filtering requires one recent grid asset, fully visible
            // in this owned simulator; composer/native/peer checks still follow.
            photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        let add = app.buttons.matching(NSPredicate(format: "label == 'Add' OR label BEGINSWITH 'Add (' OR label == 'Done' OR label == 'Choose' OR label == 'Adicionar' OR label BEGINSWITH 'Adicionar (' OR label == 'Concluído' OR label == 'Escolher'")).firstMatch
        let selected = NSPredicate { _, _ in add.exists && add.isHittable && add.isEnabled }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: selected, object: nil)], timeout: 15) == .completed else {
            throw SmokeFailure.missing("confirm system photo selection")
        }
        add.tap()
        try require(app.webViews.buttons["Remove"].firstMatch, "photo selected into composer", timeout: 20)
    }
    @MainActor private func photoCandidates(_ app: XCUIApplication) -> [XCUIElement] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = .current
        // Account for a midnight boundary between owned import and UI startup.
        let now = Date()
        let days = [now, now.addingTimeInterval(-24 * 60 * 60)]
        var patterns = Set<String>()
        for day in days {
            for format in ["MMMM dd", "MMMM d"] {
                formatter.dateFormat = format
                let prefix = NSRegularExpression.escapedPattern(for: "Photo, " + formatter.string(from: day) + ", ")
                patterns.insert("^" + prefix + "[0-9]{1,2}:[0-9]{2}.*$")
            }
        }
        let dated = NSCompoundPredicate(orPredicateWithSubpredicates: patterns.sorted().map { NSPredicate(format: "label MATCHES %@", $0) })
        let images = app.images.matching(identifier: "PXGGridLayout-Info").matching(dated).allElementsBoundByIndex
        let candidates = images.isEmpty ? app.cells.matching(dated).allElementsBoundByIndex : images
        let screen = app.frame
        return candidates.filter { element in
            let frame = element.frame
            return element.exists && element.isEnabled && screen.contains(frame) && frame.width >= 44 && frame.height >= 44 &&
                abs(frame.width - frame.height) <= max(frame.width, frame.height) * 0.25
        }
    }
    @MainActor private func photoPickerEvidence(_ app: XCUIApplication) {
        // Only the freshly created synthetic simulator. Omit text-field values,
        // WebView URLs, capabilities and full accessibility debug descriptions.
        let elements = Array(app.cells.allElementsBoundByIndex.prefix(24)) +
            Array(app.images.allElementsBoundByIndex.prefix(24)) +
            Array(app.buttons.allElementsBoundByIndex.prefix(24))
        let rows = elements.map { element in
            ["type": String(describing: element.elementType), "identifier": String(element.identifier.prefix(160)),
             "label": String(element.label.prefix(160)), "hittable": element.isHittable, "enabled": element.isEnabled,
             "x": element.frame.minX, "y": element.frame.minY, "width": element.frame.width, "height": element.frame.height] as [String: Any]
        }
        if let data = try? JSONSerialization.data(withJSONObject: rows, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) { print("IOS_SIMULATOR_PHOTO_CONTROLS " + text) }
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
