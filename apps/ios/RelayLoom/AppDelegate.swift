import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var controller: RelayViewController?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let controller = RelayViewController()
        self.controller = controller
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) { controller?.startForeground() }
    func applicationDidEnterBackground(_ application: UIApplication) { controller?.stopForBackground() }
    func applicationWillTerminate(_ application: UIApplication) { controller?.stopForBackground() }
}
