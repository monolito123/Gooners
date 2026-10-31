import GoonersPayKit
import SwiftUI

struct DevicesView: View {
    @Environment(AppModel.self) private var model
    @State private var npub = ""
    @State private var label = ""
    @State private var platform = "android"
    @State private var scanning = false

    var body: some View {
        List {
            Section {
                ForEach(model.devices, id: \.self) { d in
                    let own = d.pubkeyHex == model.settings.devicePubkey
                    HStack {
                        VStack(alignment: .leading) {
                            Text(d.label + (own ? " (este aparelho)" : ""))
                            Text("\(d.platform) · \(((try? Bech32.npub(d.pubkeyHex)) ?? "").prefix(16))…")
                                .font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        if !own {
                            Button("Remover", role: .destructive) { model.removeDevice(d.pubkeyHex) }.disabled(model.busy)
                        }
                    }
                }
            } header: {
                Text("Aparelhos autorizados")
            } footer: {
                Text("A chave raiz da loja assina esta lista. Quem sai da lista perde o acesso na hora.")
            }
            Section {
                Button("Gerar código de pareamento") { model.newEnrollmentCode() }.disabled(model.busy)
                if QRScannerView.isAvailable {
                    Button { scanning = true } label: { Label("Ler o código do novo aparelho", systemImage: "qrcode.viewfinder") }
                }
                TextField("Código do aparelho (npub…)", text: $npub)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
                TextField("Nome (ex.: Caixa 2)", text: $label)
                Picker("Sistema", selection: $platform) {
                    Text("Android").tag("android")
                    Text("iPhone").tag("ios")
                }
                .pickerStyle(.segmented)
                Button("Autorizar aparelho") {
                    model.addDevice(npub: npub, platform: platform, label: label)
                    npub = ""
                    label = ""
                }
                .buttonStyle(.primary)
                .disabled(model.busy || !npub.trimmingCharacters(in: .whitespaces).hasPrefix("npub1"))
            } header: {
                Text("Adicionar aparelho")
            } footer: {
                Text("No novo aparelho, use um código de pareamento. Ele mostra um código npub: leia-o com a câmera ou cole-o aqui.")
            }
        }
        .sheet(isPresented: $scanning) {
            QRScannerView { code in
                let c = code.trimmingCharacters(in: .whitespacesAndNewlines)
                if c.hasPrefix("npub1") { npub = c }
                scanning = false
            }
            .ignoresSafeArea()
        }
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var confirming = false
    @State private var crypto = false

    var body: some View {
        List {
            Section(model.settings.tradeName.isEmpty ? "goonersPAY" : model.settings.tradeName) {
                LabeledContent("Loja", value: model.settings.merchantID)
                LabeledContent("Aparelho", value: model.settings.deviceID)
                LabeledContent("Plataforma", value: model.settings.apiURL)
                if let npub = model.ownNpub {
                    Text(npub).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                }
            }
            Section {
                Toggle(isOn: $crypto) {
                    VStack(alignment: .leading) {
                        Text("Aceitar cripto")
                        Text("O cliente paga em USDT na rede Tron; você recebe em reais, com tarifa de 1,5%.")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
            } footer: {
                Text("Aprovação e recusa vibram de formas diferentes, para o caixa sentir o resultado sem olhar.")
            }
            Section {
                Button("Desparear este aparelho", role: .destructive) { confirming = true }
            }
            Section {
                Text("goonersPAY \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .onAppear { crypto = model.settings.acceptsCrypto }
        .onChange(of: crypto) { _, on in if on != model.settings.acceptsCrypto { model.setAcceptsCrypto(on) } }
        .confirmationDialog("Desparear este aparelho?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Apagar chaves e desparear", role: .destructive) { model.unpair() }
        } message: {
            Text("As chaves deste aparelho serão apagadas." + (model.isOwner ? " Sem a chave raiz anotada, você não poderá autorizar novos aparelhos." : ""))
        }
    }
}
