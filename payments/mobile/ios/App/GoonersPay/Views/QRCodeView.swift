import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

/// A QR code, always dark on white with a quiet zone so any camera reads it.
struct QRCodeView: View {
    let text: String
    let label: String
    var size: CGFloat = 260

    var body: some View {
        Group {
            if let image = Self.render(text) {
                Image(decorative: image, scale: 1).interpolation(.none).resizable()
            } else {
                Color.white
            }
        }
        .frame(width: size, height: size)
        .padding(8)
        .background(Color.white)
        .accessibilityElement()
        .accessibilityLabel(label)
    }

    static func render(_ text: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)) else { return nil }
        return CIContext().createCGImage(output, from: output.extent)
    }
}
