import Darwin
import Foundation
import GoonersPayKit
import MachO
import UIKit

/// The device posture signals of docs/07 §3.3 that iOS shows an app. Each is a hint, not
/// proof: a determined attacker hides them, which is why the platform never trusts the phone's
/// score alone and App Attest binds the app (§3.8). What cannot change while the app runs is
/// read once.
struct IOSPosture: PostureSource {
    private static let jailbroken: Bool = {
        let paths = ["/Applications/Cydia.app", "/Applications/Sileo.app", "/Library/MobileSubstrate/MobileSubstrate.dylib", "/bin/bash",
                     "/usr/sbin/sshd", "/etc/apt", "/private/var/lib/apt", "/var/jb"]
        if paths.contains(where: { FileManager.default.fileExists(atPath: $0) }) { return true }
        // Outside the sandbox nothing is writable.
        let probe = "/private/goonerspay-\(UUID().uuidString)"
        if (try? "x".write(toFile: probe, atomically: false, encoding: .utf8)) != nil {
            try? FileManager.default.removeItem(atPath: probe)
            return true
        }
        return false
    }()

    private static let hooked: Bool = {
        let marks = ["frida", "cynject", "libcycript", "substrate", "substitute", "tweakinject", "libhooker", "ellekit"]
        for i in 0..<_dyld_image_count() {
            guard let name = _dyld_get_image_name(i).map({ String(cString: $0).lowercased() }) else { continue }
            if marks.contains(where: name.contains) { return true }
        }
        return false
    }()

    private static var debugged: Bool {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return false }
        return info.kp_proc.p_flag & P_TRACED != 0
    }

    func signals() -> Set<String> {
        var s = Set<String>()
        if Self.debugged { s.insert("debugger") }
        if Self.jailbroken { s.insert("root_indicators") }
        if Self.hooked { s.insert("hooking") }
        #if targetEnvironment(simulator)
        s.insert("emulator")
        #endif
        // The checkout scores taps on the main actor, where the scenes can be read.
        if Thread.isMainThread, MainActor.assumeIsolated({ Self.screenCaptured() }) { s.insert("screen_captured") }
        return s
    }

    /// The screen is being recorded, mirrored or shared (screen-sharing scams).
    @MainActor private static func screenCaptured() -> Bool {
        UIApplication.shared.connectedScenes.contains { ($0 as? UIWindowScene)?.traitCollection.sceneCaptureState == .active }
    }
}
