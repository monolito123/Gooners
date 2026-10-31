import GoonersPayKit
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        return Group {
            switch model.screen {
            case .loading:
                ProgressView()
            case .setup:
                NavigationStack { SetupView() }
            case let .backup(nsec):
                NavigationStack { BackupView(nsec: nsec) }
            case let .awaitingApproval(npub, tradeName):
                NavigationStack { AwaitingApprovalView(npub: npub, tradeName: tradeName) }
            case .home:
                HomeView()
            }
        }
        .overlay(alignment: .top) {
            if model.busy { ProgressView().padding(8) }
        }
        .alert("goonersPAY", isPresented: $model.showingMessage) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.message ?? "")
        }
    }
}

struct HomeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        return TabView(selection: $model.tab) {
            ChargeView()
                .tabItem { Label("Cobrar", systemImage: "creditcard") }
                .tag(HomeTab.charge)
            NavigationStack { MoneyView().navigationTitle("Dinheiro") }
                .tabItem { Label("Dinheiro", systemImage: "banknote") }
                .tag(HomeTab.money)
            NavigationStack { AssetsView().navigationTitle("Ativos") }
                .tabItem { Label("Ativos", systemImage: "chart.line.uptrend.xyaxis") }
                .tag(HomeTab.assets)
            if model.isOwner {
                NavigationStack { DevicesView().navigationTitle("Aparelhos") }
                    .tabItem { Label("Aparelhos", systemImage: "iphone.gen3") }
                    .tag(HomeTab.devices)
            }
            NavigationStack { SettingsView().navigationTitle("Ajustes") }
                .tabItem { Label("Ajustes", systemImage: "gearshape") }
                .tag(HomeTab.settings)
        }
        .tint(Theme.action)
    }
}
