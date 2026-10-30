// swift-tools-version: 6.1
// GoonersPayKit: the merchant app's protocol and checkout logic, shared by the iOS app and
// tested on Linux and macOS against the platform's conformance vectors (docs/05 §1).
import PackageDescription

let package = Package(
    name: "GoonersPayKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "GoonersPayKit", targets: ["GoonersPayKit"]),
    ],
    dependencies: [
        // Pinned exactly (docs/05 §4: supply chain). swift-crypto is CryptoKit's API on Linux.
        .package(url: "https://github.com/apple/swift-crypto.git", exact: "5.0.1"),
        .package(url: "https://github.com/21-DOT-DEV/swift-secp256k1.git", exact: "0.23.2"),
    ],
    targets: [
        .target(
            name: "GoonersPayKit",
            dependencies: [
                .product(name: "Crypto", package: "swift-crypto"),
                .product(name: "P256K", package: "swift-secp256k1"),
            ]
        ),
        .testTarget(
            name: "GoonersPayKitTests",
            dependencies: ["GoonersPayKit"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
