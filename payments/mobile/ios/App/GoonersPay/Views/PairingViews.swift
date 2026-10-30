import GoonersPayKit
import SwiftUI

struct SetupView: View {
    @Environment(AppModel.self) private var model
    @State private var code = ""
    @State private var url = AppModel.defaultAPIURL
    @State private var cardKey = ""

    var body: some View {
        Form {
            Section {
                Text("Peça ao seu parceiro (ou ao dono da loja, no app dele) um código de pareamento. Ele vale 15 minutos e só pode ser usado uma vez.")
                    .foregroundStyle(Theme.textSecondary)
                if !model.vault.deviceIsSecure {
                    Text(AppError.noScreenLock.errorDescription ?? "").foregroundStyle(Theme.critical)
                }
            }
            Section("Pareamento") {
                TextField("Código de pareamento", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                TextField("Endereço da plataforma", text: $url)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            #if DEBUG
            Section {
                TextField("Chave de cartão do sandbox (opcional)", text: $cardKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } footer: {
                Text("Com a chave de desenvolvimento do sandbox, o app simula a leitura de cartões de teste.")
            }
            #endif
            Section {
                Button("Parear") { model.pair(apiURL: url, code: code, sandboxCardKey: cardKey) }
                    .buttonStyle(.primary)
                    .disabled(model.busy || code.trimmingCharacters(in: .whitespaces).isEmpty)
                    .listRowInsets(EdgeInsets())
            }
        }
        .navigationTitle("Parear este aparelho")
    }
}

struct BackupView: View {
    @Environment(AppModel.self) private var model
    let nsec: String
    @State private var confirmed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Esta é a chave raiz da loja. Só ela autoriza novos aparelhos. Anote no papel e guarde em lugar seguro: quem tiver esta chave controla os aparelhos da loja. Ninguém da goonersPAY vai pedi-la.")
                    .foregroundStyle(Theme.textSecondary)
                Text(stride(from: 0, to: nsec.count, by: 4).map { i in
                    String(nsec.dropFirst(i).prefix(4))
                }.joined(separator: " "))
                .font(.system(.title3, design: .monospaced))
                .textSelection(.disabled)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel("Chave raiz: " + nsec.map(String.init).joined(separator: " "))
                .privacySensitive()
                Toggle("Anotei a chave em lugar seguro", isOn: $confirmed)
                Button("Continuar") { model.backedUp() }
                    .buttonStyle(.primary)
                    .disabled(!confirmed || model.busy)
            }
            .padding()
        }
        .navigationTitle("Guarde a chave da loja")
    }
}

struct AwaitingApprovalView: View {
    @Environment(AppModel.self) private var model
    let npub: String
    let tradeName: String

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Text("No celular do dono da \(tradeName), abra Aparelhos › Adicionar e informe este código. Depois toque em Continuar.")
                    .foregroundStyle(Theme.textSecondary)
                QRCodeView(text: npub, label: "Código deste aparelho")
                Text(npub).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                ShareLink(item: npub) { Label("Compartilhar código", systemImage: "square.and.arrow.up") }
                Button("Continuar") { model.checkApproval() }
                    .buttonStyle(.primary)
                    .disabled(model.busy)
                Button("Cancelar pareamento", role: .destructive) { model.unpair() }
            }
            .padding()
        }
        .navigationTitle("Autorize este aparelho")
    }
}
