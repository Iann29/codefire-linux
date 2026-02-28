// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Context",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.0.0"),
        .package(url: "https://github.com/argmaxinc/WhisperKit.git", from: "0.9.0"),
    ],
    targets: [
        .executableTarget(
            name: "Context",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "SwiftTerm", package: "SwiftTerm"),
                .product(name: "WhisperKit", package: "WhisperKit"),
            ],
            path: "Sources/Context"
        ),
        .executableTarget(
            name: "ContextMCP",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Sources/ContextMCP"
        ),
    ]
)
