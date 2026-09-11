import Foundation

/// Resolve an asynchronous platform permission exactly once, even if its UI
/// disappears before an outstanding callback arrives.
final class OnceCompletion<Value> {
    let id = UUID()
    private let lock = NSLock()
    private var callback: ((Value) -> Void)?
    init(_ callback: @escaping (Value) -> Void) { self.callback = callback }
    func finish(_ value: Value) {
        lock.lock(); let completion = callback; callback = nil; lock.unlock()
        completion?(value)
    }
}

protocol RuntimeBackend {
    func start(data: String, assets: String) throws -> String
    func stop() throws
}

/// One serial owner for the process-wide Go singleton; stale UI stops cannot
/// shut down a replacement runtime. No UIKit or Go imports are needed to test it.
final class RuntimeCoordinator {
    private let backend: RuntimeBackend
    private let queue = DispatchQueue(label: "org.relayloom.core", qos: .userInitiated)
    private let lock = NSLock()
    private var sequence: UInt64 = 0
    private var desired: UInt64 = 0
    private var running: UInt64 = 0 // Only accessed by queue.

    init(backend: RuntimeBackend) { self.backend = backend }

    @discardableResult
    func start(prepare: @escaping () throws -> (String, String), completion: @escaping (UInt64, Result<String, Error>) -> Void) -> UInt64 {
        lock.lock(); sequence += 1; let lease = sequence; desired = lease; lock.unlock()
        queue.async {
            guard self.isCurrent(lease) else { return }
            do {
                if self.running != 0 { try self.backend.stop(); self.running = 0 }
                guard self.isCurrent(lease) else { return }
                let paths = try prepare()
                guard self.isCurrent(lease) else { return }
                let response = try self.backend.start(data: paths.0, assets: paths.1)
                self.running = lease
                guard self.isCurrent(lease) else { try self.backend.stop(); self.running = 0; return }
                completion(lease, .success(response))
            } catch {
                try? self.backend.stop(); self.running = 0
                if self.isCurrent(lease) { completion(lease, .failure(error)) }
            }
        }
        return lease
    }

    func stop(_ lease: UInt64, completion: @escaping () -> Void = {}) {
        guard lease != 0 else { completion(); return }
        lock.lock(); if desired == lease { desired = 0 }; lock.unlock()
        queue.async {
            if self.running == lease { try? self.backend.stop(); self.running = 0 }
            completion()
        }
    }

    func isCurrent(_ lease: UInt64) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return lease != 0 && desired == lease
    }

    func drainForTest() { queue.sync {} }
}
