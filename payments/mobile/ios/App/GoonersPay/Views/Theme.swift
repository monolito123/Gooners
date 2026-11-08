import SwiftUI
import UIKit

// The app's theme, built from the generated tokens (DesignTokens.swift, from payments/design/tokens.json).
extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double(hex >> 16 & 0xff) / 255, green: Double(hex >> 8 & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }

    /// A color for each appearance, as the semantic tokens define it.
    init(light: UInt32, dark: UInt32) {
        let l = Self.uiColor(light), d = Self.uiColor(dark)
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? d : l })
    }

    /// A semantic role, light and dark, from the generated themes.
    init(role: KeyPath<SemanticPalette, UInt32>) {
        self.init(light: Themes.light[keyPath: role], dark: Themes.dark[keyPath: role])
    }

    private static func uiColor(_ h: UInt32) -> UIColor {
        UIColor(red: CGFloat(h >> 16 & 0xff) / 255, green: CGFloat(h >> 8 & 0xff) / 255, blue: CGFloat(h & 0xff) / 255, alpha: 1)
    }
}

enum Theme {
    static let canvas = Color(role: \.canvas)
    static let surface = Color(role: \.surface)
    static let surfaceRaised = Color(role: \.surfaceRaised)
    static let border = Color(role: \.border)
    static let textPrimary = Color(role: \.textPrimary)
    static let textSecondary = Color(role: \.textSecondary)
    /// The fill of the one primary action (mint in both appearances).
    static let action = Color(role: \.actionFill)
    static let onAction = Color(role: \.onAction)
    /// The action colour as text, outline or tint: the shade that reads on the background.
    static let actionText = Color(light: Themes.light.actionBorder, dark: Themes.dark.actionFill)
    static let positive = Color(role: \.successText)
    static let critical = Color(role: \.alertText)
    static let warning = Color(role: \.attentionText)
    static let info = Color(role: \.infoText)

    /// The series a chart is about, what it is compared with, and the hairline grid.
    static let chartFocus = Color(role: \.chartFocus)
    static let chartCompare = Color(role: \.chartCompare)
    static let chartGrid = Color(role: \.chartGrid)

    /// Payment methods in charts and lists.
    static func method(_ m: String) -> Color {
        switch m {
        case "credit": Color(role: \.chartCredit)
        case "debit": Color(role: \.chartDebit)
        case "pix": Color(role: \.chartPix)
        case "crypto": Color(role: \.chartCrypto)
        default: Color(role: \.chartOther)
        }
    }

    static let touchMin = Sizes.touchMin
    static let keypadKey = Sizes.keypadKey
    /// The primary action's height, in the bottom quarter of the screen (docs/06 §4).
    static let ctaHeight = Sizes.ctaHeight
}

extension Font {
    /// A style of the type scale at its base size (hero figures; body text keeps Dynamic Type styles).
    static func scale(_ t: TypeStyle) -> Font {
        let f = Font.system(size: t.size, weight: t.weight)
        return t.tabular ? f.monospacedDigit() : f
    }
}

/// The full-width primary action.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: Theme.touchMin)
            .foregroundStyle(Theme.onAction)
            .background(Theme.action.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.4), in: RoundedRectangle(cornerRadius: Radius.md))
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

/// A full-width second choice: outlined, so only one button per screen is filled.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: Theme.touchMin)
            .foregroundStyle(Theme.actionText.opacity(enabled ? 1 : 0.4))
            .background(Theme.surface.opacity(configuration.isPressed ? 0.6 : 1), in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).stroke(Theme.actionText.opacity(enabled ? 1 : 0.4), lineWidth: 1.5))
    }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var secondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}

/// A grouped surface: the card every section of a screen sits on.
struct CardModifier: ViewModifier {
    var padding: CGFloat = Space.lg

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).stroke(Theme.border.opacity(0.6), lineWidth: 1))
    }
}

extension View {
    /// Puts the view on a card (docs/06 §6: one action per card).
    func card(padding: CGFloat = Space.lg) -> some View { modifier(CardModifier(padding: padding)) }
}
