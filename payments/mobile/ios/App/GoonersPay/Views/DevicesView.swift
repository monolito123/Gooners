import GoonersPayKit
import SwiftUI

struct DevicesView: View {
    @Environment(AppModel.self) private var model
    @State private var npub = ""
    @State private var label = ""
    @State private var platform = "android"

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
                Text("No novo aparelho, use um código de pareamento. Ele mostra um código npub: cole-o aqui.")
            }
        }
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var confirming = false

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
                Button("Desparear este aparelho", role: .destructive) { confirming = true }
            }
            Section {
                Text("goonersPAY \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .confirmationDialog("Desparear este aparelho?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Apagar chaves e desparear", role: .destructive) { model.unpair() }
        } message: {
            Text("As chaves deste aparelho serão apagadas." + (model.isOwner ? " Sem a chave raiz anotada, você não poderá autorizar novos aparelhos." : ""))
        }
    }
}
