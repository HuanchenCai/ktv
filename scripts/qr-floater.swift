// Always-on-top, borderless, click-through QR sticker for macOS.
// Mirrors the Windows PowerShell+WinForms script.
//
// Run with:
//   swift scripts/qr-floater.swift --image <path> [--corner top-right]
//     [--size 220] [--margin 24] [--label "扫码点歌"]
//     [--label-color "#be185d"]
//
// Requires Xcode Command Line Tools (`xcode-select --install`) so
// `swift` is on PATH. Backend skips the spawn if it isn't.

import Cocoa

// ---- argv parsing -------------------------------------------------------

let argv = CommandLine.arguments

func argValue(_ name: String, _ fallback: String) -> String {
    if let i = argv.firstIndex(of: name), i + 1 < argv.count {
        return argv[i + 1]
    }
    return fallback
}

let imagePath = argValue("--image", "")
let corner = argValue("--corner", "top-right")
let size = CGFloat(Int(argValue("--size", "220")) ?? 220)
let margin = CGFloat(Int(argValue("--margin", "24")) ?? 24)
let labelText = argValue("--label", "扫码点歌")
let labelHex = argValue("--label-color", "#be185d")

guard !imagePath.isEmpty, FileManager.default.fileExists(atPath: imagePath) else {
    print("[qr-floater] image not found: \(imagePath)")
    exit(2)
}

// ---- color helper -------------------------------------------------------

func colorFromHex(_ hex: String) -> NSColor {
    var s = hex
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6 else {
        return NSColor(red: 0.745, green: 0.094, blue: 0.365, alpha: 1)
    }
    var val: UInt64 = 0
    Scanner(string: s).scanHexInt64(&val)
    return NSColor(
        red: CGFloat((val >> 16) & 0xFF) / 255.0,
        green: CGFloat((val >> 8) & 0xFF) / 255.0,
        blue: CGFloat(val & 0xFF) / 255.0,
        alpha: 1.0
    )
}

// ---- app + window -------------------------------------------------------

let app = NSApplication.shared
// `.accessory` keeps the process out of the Dock and Cmd-Tab list — it's
// a background sticker, not an app the user switches to.
app.setActivationPolicy(.accessory)

guard let screen = NSScreen.main else { exit(1) }

let labelH: CGFloat = 24
let cellW = size
let cellH = size + labelH

let frame = screen.visibleFrame
var x: CGFloat = 0
var y: CGFloat = 0
switch corner {
case "top-left":
    x = frame.minX + margin
    y = frame.maxY - cellH - margin
case "top-right":
    x = frame.maxX - cellW - margin
    y = frame.maxY - cellH - margin
case "bottom-left":
    x = frame.minX + margin
    y = frame.minY + margin
case "bottom-right":
    x = frame.maxX - cellW - margin
    y = frame.minY + margin
default:
    x = frame.maxX - cellW - margin
    y = frame.maxY - cellH - margin
}

let window = NSWindow(
    contentRect: NSRect(x: x, y: y, width: cellW, height: cellH),
    styleMask: [.borderless],
    backing: .buffered,
    defer: false
)
// CGShieldingWindowLevel sits above the menu bar and above any app
// in native fullscreen Spaces (when collectionBehavior allows joining).
window.level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))
window.collectionBehavior = [
    .canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle, .stationary,
]
window.isOpaque = false
window.backgroundColor = NSColor.clear
window.ignoresMouseEvents = true
window.hasShadow = false

// ---- content ------------------------------------------------------------

let container = NSView(frame: NSRect(x: 0, y: 0, width: cellW, height: cellH))
container.wantsLayer = true

// Image at the BOTTOM of the cell (AppKit y-axis is bottom-up).
let imageView = NSImageView(frame: NSRect(x: 0, y: 0, width: cellW, height: size))
imageView.imageScaling = .scaleProportionallyUpOrDown
imageView.wantsLayer = true
imageView.layer?.backgroundColor = NSColor.white.cgColor
container.addSubview(imageView)

// Label across the TOP of the cell.
let label = NSTextField(labelWithString: labelText)
label.alignment = .center
label.font = NSFont.boldSystemFont(ofSize: 13)
label.textColor = .white
label.drawsBackground = true
label.backgroundColor = colorFromHex(labelHex)
label.isBezeled = false
label.isEditable = false
label.frame = NSRect(x: 0, y: size, width: cellW, height: labelH)
container.addSubview(label)

window.contentView = container

// ---- live image reload --------------------------------------------------

func loadImage() {
    if let img = NSImage(contentsOfFile: imagePath) {
        imageView.image = img
    }
}
loadImage()

var lastMod: Date? =
    (try? FileManager.default.attributesOfItem(atPath: imagePath))?[.modificationDate]
    as? Date

// Re-assert level (in case anything tried to dethrone us) and reload the
// PNG if the backend rewrote it. 2 s matches the Windows side.
Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
    window.level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))
    if let mod = (try? FileManager.default.attributesOfItem(atPath: imagePath))?[
        .modificationDate
    ] as? Date,
        mod != lastMod
    {
        lastMod = mod
        loadImage()
    }
}

window.orderFrontRegardless()
app.run()
