import SwiftUI

@main
struct GoonersPayApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // Amounts, QR codes and the root key backup stay out of the app switcher.
                .overlay {
                    if phase != .active {
                        Theme.canvas.ignoresSafeArea().overlay { Text("goonersPAY").font(.largeTitle.bold()) }
                    }
                }
                .task { model.resume() }
        }
    }
}
