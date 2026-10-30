import SwiftUI
import UIKit

// payments/design/tokens: the primitives the app uses.
extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double(hex >> 16 & 0xff) / 255, green: Double(hex >> 8 & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }

    /// A color for each appearance, as the semantic tokens define it.
    init(light: UInt32, dark: UInt32) {
        let l = Self.uiColor(light), d = Self.uiColor(dark)
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? d : l })
    }

    private static func uiColor(_ h: UInt32) -> UIColor {
        UIColor(red: CGFloat(h >> 16 & 0xff) / 255, green: CGFloat(h >> 8 & 0xff) / 255, blue: CGFloat(h & 0xff) / 255, alpha: 1)
    }
}

enum Theme {
    static let canvas = Color(light: 0xF8FAFC, dark: 0x0B0F19)
    static let surface = Color(light: 0xFFFFFF, dark: 0x111827)
    static let textPrimary = Color(light: 0x111827, dark: 0xF8FAFC)
    static let textSecondary = Color(light: 0x334155, dark: 0xCBD5E1)
    static let action = Color(light: 0x047857, dark: 0x10B981)
    static let onAction = Color(light: 0xFFFFFF, dark: 0x0B0F19)
    static let positive = Color(light: 0x047857, dark: 0x34D399)
    static let critical = Color(light: 0xBE123C, dark: 0xFB7185)
    static let warning = Color(light: 0xB45309, dark: 0xF59E0B)

    static let touchMin: CGFloat = 48
    static let keypadKey: CGFloat = 72
}

/// The full-width primary action.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: Theme.touchMin)
            .foregroundStyle(Theme.onAction)
            .background(Theme.action.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.4), in: RoundedRectangle(cornerRadius: 12))
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}
