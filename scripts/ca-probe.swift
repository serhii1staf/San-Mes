// Probe for modules/san-glass on macOS (compiled together with SanGlassCapture.swift and
// SanGlassShader.swift, the same files the app ships):
//
//   1. The culled capture (SanGlassLayerCapture) against Core Animation's own render(in:) of every
//      sibling subtree beneath the glass (what the first version did), on a tree shaped like the
//      profile screen: pixel difference and time, for three glass positions.
//   2. The Metal shader: compile it, render the glass looks over a test backdrop, write PNGs.
//
// Usage: probe <output directory>
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import Metal
import MetalPerformanceShaders
import QuartzCore
import UniformTypeIdentifiers

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "out"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
let rgb = CGColorSpaceCreateDeviceRGB()
let bgraInfo = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue

func savePNG(_ image: CGImage, _ name: String) {
  let url = URL(fileURLWithPath: outDir).appendingPathComponent(name) as CFURL
  guard let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else { return }
  CGImageDestinationAddImage(dest, image, nil)
  CGImageDestinationFinalize(dest)
}

final class TextDelegate: NSObject, CALayerDelegate {
  let line: CTLine
  init(_ s: String, size: CGFloat = 15) {
    let font = CTFontCreateWithName("Helvetica" as CFString, size, nil)
    let white = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
    let attr = NSAttributedString(string: s, attributes: [
      NSAttributedString.Key(kCTFontAttributeName as String): font,
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): white,
    ])
    line = CTLineCreateWithAttributedString(attr)
  }
  func draw(_ layer: CALayer, in ctx: CGContext) {
    ctx.textMatrix = .identity
    ctx.translateBy(x: 0, y: layer.bounds.height)
    ctx.scaleBy(x: 1, y: -1)
    ctx.textPosition = CGPoint(x: 4, y: 6)
    CTLineDraw(line, ctx)
  }
}

func makeImage(_ w: Int, _ h: Int, seed: Int) -> CGImage {
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: rgb, bitmapInfo: bgraInfo)!
  for y in stride(from: 0, to: h, by: 6) {
    let t = CGFloat((y + seed * 37) % 255) / 255
    ctx.setFillColor(CGColor(red: t, green: 0.35 + 0.3 * (1 - t), blue: 0.8 - 0.5 * t, alpha: 1))
    ctx.fill(CGRect(x: 0, y: y, width: w, height: 6))
  }
  ctx.setFillColor(CGColor(red: 1, green: 0.9, blue: 0.2, alpha: 1))
  ctx.fillEllipse(in: CGRect(x: w / 4, y: h / 4, width: w / 2, height: h / 2))
  return ctx.makeImage()!
}

var delegates: [TextDelegate] = []
func text(_ s: String, _ frame: CGRect, size: CGFloat = 15) -> CALayer {
  let t = CALayer()
  t.frame = frame
  t.contentsScale = 2
  let d = TextDelegate(s, size: size)
  t.delegate = d
  delegates.append(d)
  return t
}

// ── An RN-shaped tree: window → screen → scroll view (scrolled) → content (header card + 60 cards),
// and the tab bar after the screen. Non-clipping wrappers everywhere, as Fabric makes them. ─────────
let screenW: CGFloat = 393
let screenH: CGFloat = 852
let banner = makeImage(400, 300, seed: 1)
let thumb = makeImage(120, 120, seed: 5)

let window = CALayer()
window.frame = CGRect(x: 0, y: 0, width: screenW, height: screenH)
window.backgroundColor = CGColor(red: 0.07, green: 0.06, blue: 0.1, alpha: 1)

let screen = CALayer()
screen.frame = window.bounds
window.addSublayer(screen)

let scroll = CALayer()
scroll.frame = screen.bounds
scroll.masksToBounds = true
scroll.bounds.origin.y = 140 // scrolled
screen.addSublayer(scroll)

let content = CALayer()
content.frame = CGRect(x: 0, y: 0, width: screenW, height: 520 + 60 * 150)
scroll.addSublayer(content)

// Header card: bottom corners rounded through a shape mask (non-uniform radii), banner, gradient,
// texts, a translucent group with overlapping children, a turned leaf.
let header = CALayer()
header.frame = CGRect(x: 0, y: 0, width: screenW, height: 500)
header.backgroundColor = CGColor(red: 0.15, green: 0.12, blue: 0.2, alpha: 1)
let headerMask = CAShapeLayer()
headerMask.frame = header.bounds
headerMask.path = SanGlassLayerCapture.roundedPath(header.bounds, radius: 30, corners: [.layerMinXMaxYCorner, .layerMaxXMaxYCorner])
header.mask = headerMask
content.addSublayer(header)
let bannerLayer = CALayer()
bannerLayer.frame = header.bounds
bannerLayer.contents = banner
bannerLayer.contentsGravity = .resizeAspectFill
header.addSublayer(bannerLayer)
let gradient = CAGradientLayer()
gradient.frame = header.bounds
gradient.colors = [CGColor(red: 0, green: 0, blue: 0, alpha: 0), CGColor(red: 0.07, green: 0.06, blue: 0.1, alpha: 0.6)]
header.addSublayer(gradient)
let headerBody = CALayer() // non-clipping wrapper, like a padding View
headerBody.frame = CGRect(x: 20, y: 110, width: screenW - 40, height: 370)
header.addSublayer(headerBody)
let avatar = CALayer()
avatar.frame = CGRect(x: 0, y: 0, width: 84, height: 84)
avatar.backgroundColor = CGColor(red: 0.2, green: 0.2, blue: 0.24, alpha: 1)
avatar.cornerRadius = 26
avatar.borderWidth = 1
avatar.borderColor = CGColor(red: 1, green: 1, blue: 1, alpha: 0.3)
headerBody.addSublayer(avatar)
headerBody.addSublayer(text("Brick", CGRect(x: 0, y: 96, width: 200, height: 30), size: 24))
headerBody.addSublayer(text("@brick", CGRect(x: 0, y: 128, width: 200, height: 22)))
for i in 0..<4 {
  headerBody.addSublayer(text("Bio line \(i) with a few words in it", CGRect(x: 0, y: 160 + CGFloat(i) * 22, width: 330, height: 22)))
}
let group = CALayer()
group.frame = CGRect(x: 0, y: 260, width: 300, height: 60)
group.opacity = 0.6
for i in 0..<3 {
  let pill = CALayer()
  pill.frame = CGRect(x: CGFloat(i) * 70, y: 8, width: 110, height: 44)
  pill.backgroundColor = CGColor(red: 0.55, green: 0.33, blue: 0.75, alpha: 1)
  pill.cornerRadius = 22
  group.addSublayer(pill)
}
headerBody.addSublayer(group)
let turned = CALayer()
turned.bounds = CGRect(x: 0, y: 0, width: 60, height: 60)
turned.position = CGPoint(x: 300, y: 40)
turned.contents = thumb
turned.cornerRadius = 14
turned.masksToBounds = true
turned.setAffineTransform(CGAffineTransform(rotationAngle: 0.35))
headerBody.addSublayer(turned)
let faded = text("A translucent leaf", CGRect(x: 0, y: 330, width: 200, height: 22))
faded.opacity = 0.5
headerBody.addSublayer(faded)
let hiddenLayer = CALayer()
hiddenLayer.frame = CGRect(x: 0, y: 0, width: 300, height: 300)
hiddenLayer.backgroundColor = CGColor(red: 1, green: 0, blue: 0, alpha: 1)
hiddenLayer.isHidden = true
headerBody.addSublayer(hiddenLayer)

// Tab strip and 60 post cards.
let strip = CALayer()
strip.frame = CGRect(x: 16, y: 518, width: screenW - 32, height: 46)
strip.backgroundColor = CGColor(red: 0.18, green: 0.15, blue: 0.24, alpha: 1)
strip.cornerRadius = 20
strip.zPosition = 10
content.addSublayer(strip)
for i in 0..<60 {
  let card = CALayer()
  card.frame = CGRect(x: 16, y: 580 + CGFloat(i) * 150, width: screenW - 32, height: 138)
  card.backgroundColor = CGColor(red: 0.11, green: 0.1, blue: 0.15, alpha: 1)
  card.cornerRadius = 28
  card.masksToBounds = true
  card.borderWidth = 1
  card.borderColor = CGColor(red: 1, green: 1, blue: 1, alpha: 0.08)
  let img = CALayer()
  img.frame = CGRect(x: 14, y: 14, width: 110, height: 110)
  img.contents = thumb
  img.contentsGravity = .resizeAspectFill
  img.cornerRadius = 20
  img.masksToBounds = true
  card.addSublayer(img)
  let row = CALayer() // non-clipping row whose badge pokes out above it
  row.frame = CGRect(x: 136, y: 20, width: 200, height: 30)
  let badge = CALayer()
  badge.frame = CGRect(x: 150, y: -8, width: 40, height: 18)
  badge.backgroundColor = CGColor(red: 0.95, green: 0.3, blue: 0.4, alpha: 1)
  badge.cornerRadius = 9
  badge.zPosition = 2
  row.addSublayer(badge)
  row.addSublayer(text("Post \(i) by Brick", CGRect(x: 0, y: 0, width: 160, height: 24)))
  card.addSublayer(row)
  for j in 0..<3 {
    card.addSublayer(text("Line \(j) of post \(i), some text", CGRect(x: 136, y: 54 + CGFloat(j) * 24, width: 220, height: 22)))
  }
  content.addSublayer(card)
}

// The tab bar after the screen: a non-clipping container with the main capsule and the profile
// capsule; the glass sits inside each capsule.
let tabBar = CALayer()
tabBar.frame = CGRect(x: 0, y: screenH - 100, width: screenW, height: 100)
window.addSublayer(tabBar)
let capsule = CALayer()
capsule.frame = CGRect(x: 60, y: 10, width: 172, height: 60)
capsule.cornerRadius = 30
tabBar.addSublayer(capsule)
let barGlass = CALayer()
barGlass.frame = capsule.bounds
capsule.addSublayer(barGlass)
// A header glass at the top of the screen, and a menu glass over the middle.
let headerGlass = CALayer()
headerGlass.frame = CGRect(x: 0, y: 0, width: screenW, height: 100)
window.addSublayer(headerGlass)
let menuGlass = CALayer()
menuGlass.frame = CGRect(x: 120, y: 220, width: 250, height: 260)
window.addSublayer(menuGlass)

func allLayers(_ l: CALayer) -> [CALayer] { (l.sublayers ?? []).flatMap { [$0] + allLayers($0) } }
for l in [window] + allLayers(window) where l.delegate != nil { l.setNeedsDisplay(); l.displayIfNeeded() }
let layerCount = 1 + allLayers(window).count

// ── The capture algorithms, for a glass layer at `glass` ────────────────────────────────────────────
func levels(_ glass: CALayer) -> [(parent: CALayer, branch: CALayer, glassToParent: CGAffineTransform)] {
  var out: [(parent: CALayer, branch: CALayer, glassToParent: CGAffineTransform)] = []
  var toAncestor = CGAffineTransform.identity
  var child = glass
  while let parent = child.superlayer {
    toAncestor = toAncestor.concatenating(SanGlassLayerCapture.layerToSuperlayer(child))
    out.append((parent, child, toAncestor))
    child = parent
  }
  return out
}

func makeContext(_ glass: CALayer, scale: CGFloat) -> CGContext {
  let w = Int((glass.bounds.width * scale).rounded(.up))
  let h = Int((glass.bounds.height * scale).rounded(.up))
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: rgb, bitmapInfo: bgraInfo)!
  ctx.clear(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.translateBy(x: 0, y: CGFloat(h))
  ctx.scaleBy(x: CGFloat(w) / glass.bounds.width, y: -CGFloat(h) / glass.bounds.height)
  ctx.clip(to: glass.bounds)
  return ctx
}

/// Ground truth: Core Animation drawing the whole window into the glass's area (the glass layers
/// themselves draw nothing, and nothing in this tree sits above them where they are).
func captureTruth(_ glass: CALayer, into ctx: CGContext) {
  let all = levels(glass)
  ctx.saveGState()
  ctx.concatenate(all.last!.glassToParent.inverted())
  window.render(in: ctx)
  ctx.restoreGState()
}

/// The first version: each ancestor's background and render(in:) of every sibling subtree beneath.
func captureOld(_ glass: CALayer, into ctx: CGContext) {
  for level in levels(glass).reversed() {
    let parentToGlass = level.glassToParent.inverted()
    ctx.saveGState()
    ctx.concatenate(parentToGlass)
    SanGlassLayerCapture.drawBackground(of: level.parent, in: ctx)
    for sub in SanGlassLayerCapture.drawingOrder(level.parent.sublayers ?? []) {
      if sub === level.branch { break }
      if sub.isHidden || sub.opacity < 0.01 { continue }
      ctx.saveGState()
      ctx.concatenate(SanGlassLayerCapture.layerToSuperlayer(sub))
      if sub.opacity < 0.999 { ctx.setAlpha(CGFloat(sub.opacity)) }
      sub.render(in: ctx)
      ctx.restoreGState()
    }
    ctx.restoreGState()
  }
}

let culler = SanGlassLayerCapture()
func captureNew(_ glass: CALayer, into ctx: CGContext) {
  culler.target = glass.bounds
  culler.resetCounts()
  for level in levels(glass).reversed() {
    let parentToGlass = level.glassToParent.inverted()
    ctx.saveGState()
    ctx.concatenate(parentToGlass)
    SanGlassLayerCapture.drawBackground(of: level.parent, in: ctx)
    for sub in SanGlassLayerCapture.drawingOrder(level.parent.sublayers ?? []) {
      if sub === level.branch { break }
      culler.draw(sub, parentToTarget: parentToGlass, in: ctx)
    }
    ctx.restoreGState()
  }
}

func median(_ xs: [Double]) -> Double { let s = xs.sorted(); return s[s.count / 2] }
func timeMs(_ runs: Int, _ body: () -> Void) -> Double {
  var xs: [Double] = []
  for _ in 0..<runs { let t0 = CACurrentMediaTime(); body(); xs.append((CACurrentMediaTime() - t0) * 1000) }
  return median(xs)
}

func diff(_ a: CGContext, _ b: CGContext) -> (count: Int, max: Int, total: Int) {
  let n = a.width * a.height
  let pa = a.data!.assumingMemoryBound(to: UInt8.self)
  let pb = b.data!.assumingMemoryBound(to: UInt8.self)
  var count = 0
  var worst = 0
  for i in 0..<n {
    var m = 0
    for c in 0..<4 { m = max(m, abs(Int(pa[i * 4 + c]) - Int(pb[i * 4 + c]))) }
    if m > 3 { count += 1 }
    worst = max(worst, m)
  }
  return (count, worst, n)
}

print("probe: \(ProcessInfo.processInfo.operatingSystemVersionString), \(layerCount) layers")
for (name, glass) in [("tabbar", barGlass), ("header", headerGlass), ("menu", menuGlass)] {
  let truth = makeContext(glass, scale: 2)
  captureTruth(glass, into: truth)
  let a = makeContext(glass, scale: 2)
  captureOld(glass, into: a)
  let b = makeContext(glass, scale: 2)
  captureNew(glass, into: b)
  let dOld = diff(truth, a)
  let dNew = diff(truth, b)
  savePNG(truth.makeImage()!, "capture-\(name)-0-truth.png")
  savePNG(a.makeImage()!, "capture-\(name)-1-old.png")
  savePNG(b.makeImage()!, "capture-\(name)-2-culled.png")
  let tOld = timeMs(25) { captureOld(glass, into: makeContext(glass, scale: 2)) }
  let tNew = timeMs(25) { captureNew(glass, into: makeContext(glass, scale: 2)) }
  let tHalf = timeMs(25) { captureNew(glass, into: makeContext(glass, scale: 0.5)) }
  print(String(format: "capture %@: old %.2f ms, culled %.3f ms (%.0fx), culled at 0.5x %.3f ms | visited %d, rendered %d, whole %d",
               name, tOld, tNew, tOld / max(tNew, 0.0001), tHalf, culler.counts.visited, culler.counts.rendered, culler.counts.whole))
  print("    pixels off by >3 from window.render(in:): old \(dOld.count) (max \(dOld.max)), culled \(dNew.count) (max \(dNew.max)) of \(dNew.total)")
}

// ── The scene signature (SanGlassLayerCapture.signature) ───────────────────────────────────────────
// What SanGlassView compares before each capture (same levels, same order as its sceneSignature): it
// must change when anything the capture would draw changes, stay equal when nothing does, and cost a
// small fraction of a capture.
func sceneSignature(_ glass: CALayer) -> UInt64 {
  var h = SanGlassLayerCapture.signatureSeed
  culler.target = glass.bounds
  SanGlassLayerCapture.mix(&h, glass.bounds.width)
  SanGlassLayerCapture.mix(&h, glass.bounds.height)
  for level in levels(glass) {
    let parentToGlass = level.glassToParent.inverted()
    SanGlassLayerCapture.mix(&h, object: level.parent)
    SanGlassLayerCapture.mix(&h, parentToGlass)
    SanGlassLayerCapture.mix(&h, color: level.parent.backgroundColor)
    for sub in SanGlassLayerCapture.drawingOrder(level.parent.sublayers ?? []) {
      if sub === level.branch { break }
      culler.signature(sub, parentToTarget: parentToGlass, into: &h)
    }
  }
  return h
}

var signatureFailures = 0
func expectSignature(_ name: String, _ glass: CALayer, changes: Bool, _ mutate: () -> Void, _ restore: () -> Void) {
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  let before = sceneSignature(glass)
  mutate()
  let after = sceneSignature(glass)
  restore()
  let back = sceneSignature(glass)
  CATransaction.commit()
  let ok = (before != after) == changes && back == before
  if !ok { signatureFailures += 1 }
  print("signature \(ok ? "PASS" : "FAIL"): \(name) (expected \(changes ? "a change" : "no change"), restored \(back == before ? "equal" : "DIFFERENT"))")
}

print("signature: stable \(sceneSignature(headerGlass) == sceneSignature(headerGlass) ? "PASS" : "FAIL")")
expectSignature("list scrolled 1 pt under the header", headerGlass, changes: true, { scroll.bounds.origin.y += 1 }, { scroll.bounds.origin.y -= 1 })
expectSignature("banner image replaced under the header", headerGlass, changes: true, { bannerLayer.contents = thumb }, { bannerLayer.contents = banner })
expectSignature("hidden layer shown under the header", headerGlass, changes: true, { hiddenLayer.isHidden = false }, { hiddenLayer.isHidden = true })
expectSignature("group opacity changed under the menu", menuGlass, changes: true, { group.opacity = 0.3 }, { group.opacity = 0.6 })
expectSignature("menu glass moved 5 pt", menuGlass, changes: true, { menuGlass.position.y += 5 }, { menuGlass.position.y -= 5 })
expectSignature("avatar corner radius changed under the header", headerGlass, changes: true, { avatar.cornerRadius = 10 }, { avatar.cornerRadius = 26 })
let farCard = content.sublayers![content.sublayers!.count - 1]
let farColor = farCard.backgroundColor
expectSignature("card far off screen recoloured (header)", headerGlass, changes: false, { farCard.backgroundColor = CGColor(red: 1, green: 0, blue: 0, alpha: 1) }, { farCard.backgroundColor = farColor })
expectSignature("card far off screen recoloured (tab bar)", barGlass, changes: false, { farCard.backgroundColor = CGColor(red: 1, green: 0, blue: 0, alpha: 1) }, { farCard.backgroundColor = farColor })
for (name, glass) in [("tabbar", barGlass), ("header", headerGlass), ("menu", menuGlass)] {
  let tSig = timeMs(200) { _ = sceneSignature(glass) }
  let tCap = timeMs(25) { captureNew(glass, into: makeContext(glass, scale: 1)) }
  print(String(format: "signature %@: %.4f ms against a 1x capture of %.3f ms (%.0fx cheaper)", name, tSig, tCap, tCap / max(tSig, 0.00001)))
}
print("signature: \(signatureFailures == 0 ? "all checks passed" : "\(signatureFailures) FAILED")")

// ── The shader ──────────────────────────────────────────────────────────────────────────────────────
guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
  print("metal: no device on this machine; shader not checked")
  exit(0)
}
print("metal: \(device.name), MPS \(MPSSupportsMTLDevice(device))")
let library: MTLLibrary
do { library = try device.makeLibrary(source: sanGlassShaderSource, options: nil) } catch {
  print("metal: shader did not compile: \(error)")
  exit(1)
}
let descriptor = MTLRenderPipelineDescriptor()
descriptor.vertexFunction = library.makeFunction(name: "san_glass_vertex")
descriptor.fragmentFunction = library.makeFunction(name: "san_glass_fragment")
descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
let pipeline = try! device.makeRenderPipelineState(descriptor: descriptor)
print("metal: shader compiled, uniforms stride \(MemoryLayout<SanGlassUniforms>.stride)")

/// The test backdrop, in pt: stripes, text, a photo, so bending, frost and tint are all visible.
func drawBackdrop(_ ctx: CGContext, _ size: CGSize, light: Bool) {
  ctx.setFillColor(light ? CGColor(red: 0.95, green: 0.95, blue: 0.97, alpha: 1) : CGColor(red: 0.07, green: 0.06, blue: 0.1, alpha: 1))
  ctx.fill(CGRect(origin: .zero, size: size))
  ctx.draw(banner, in: CGRect(x: 10, y: 10, width: size.width * 0.45, height: size.height - 20))
  for i in 0..<14 {
    ctx.setFillColor(CGColor(red: CGFloat(i % 3) * 0.4, green: 0.5, blue: CGFloat(i % 4) * 0.25, alpha: 1))
    ctx.fill(CGRect(x: size.width * 0.5 + CGFloat(i) * 12, y: 0, width: 5, height: size.height))
  }
  let font = CTFontCreateWithName("Helvetica-Bold" as CFString, 22, nil)
  let attr = NSAttributedString(string: "Что нового? San glass 123", attributes: [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): light ? CGColor(red: 0, green: 0, blue: 0, alpha: 1) : CGColor(red: 1, green: 1, blue: 1, alpha: 1),
  ])
  ctx.textPosition = CGPoint(x: 16, y: size.height / 2 - 8)
  CTLineDraw(CTLineCreateWithAttributedString(attr), ctx)
}

func bitmap(_ size: CGSize, scale: CGFloat, light: Bool) -> CGContext {
  let w = Int((size.width * scale).rounded(.up))
  let h = Int((size.height * scale).rounded(.up))
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: rgb, bitmapInfo: bgraInfo)!
  ctx.scaleBy(x: scale, y: scale)
  drawBackdrop(ctx, size, light: light)
  return ctx
}

func texture(from ctx: CGContext, usage: MTLTextureUsage = [.shaderRead]) -> MTLTexture {
  let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: ctx.width, height: ctx.height, mipmapped: false)
  d.usage = usage
  let t = device.makeTexture(descriptor: d)!
  // A bitmap context's memory starts with the top row, as a texture's does.
  t.replace(region: MTLRegionMake2D(0, 0, ctx.width, ctx.height), mipmapLevel: 0, withBytes: ctx.data!, bytesPerRow: ctx.bytesPerRow)
  return t
}

func render(_ name: String, size: CGSize, look: SanGlassLook, light: Bool) {
  let scale: CGFloat = 3
  let captureScale: CGFloat = look.blur >= 6 ? 0.5 : (look.blur >= 2 ? 1 : 2)
  let live = bitmap(size, scale: scale, light: light)
  var source = texture(from: bitmap(size, scale: captureScale, light: light), usage: [.shaderRead])
  let commandBuffer = queue.makeCommandBuffer()!
  if look.blur > 0 {
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: source.width, height: source.height, mipmapped: false)
    d.usage = [.shaderRead, .shaderWrite]
    d.storageMode = .private
    let blurred = device.makeTexture(descriptor: d)!
    let blur = MPSImageGaussianBlur(device: device, sigma: look.blur * Float(captureScale))
    blur.edgeMode = .clamp
    blur.encode(commandBuffer: commandBuffer, sourceTexture: source, destinationTexture: blurred)
    source = blurred
  }
  let w = live.width
  let h = live.height
  let od = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
  od.usage = [.renderTarget, .shaderRead]
  od.storageMode = .shared
  let output = device.makeTexture(descriptor: od)!
  let pass = MTLRenderPassDescriptor()
  pass.colorAttachments[0].texture = output
  pass.colorAttachments[0].loadAction = .clear
  pass.colorAttachments[0].storeAction = .store
  pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
  let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass)!
  var uniforms = look.uniforms(size: SIMD2<Float>(Float(w), Float(h)), scale: Float(scale), most: SanGlassBezel.most)
  encoder.setRenderPipelineState(pipeline)
  encoder.setFragmentTexture(source, index: 0)
  encoder.setFragmentBytes(&uniforms, length: MemoryLayout<SanGlassUniforms>.stride, index: 0)
  encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
  encoder.endEncoding()
  commandBuffer.commit()
  commandBuffer.waitUntilCompleted()
  // The glass composited over the live backdrop, premultiplied, as the compositor does.
  var glass = [UInt8](repeating: 0, count: w * h * 4)
  output.getBytes(&glass, bytesPerRow: w * 4, from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
  let dst = live.data!.assumingMemoryBound(to: UInt8.self)
  let rowBytes = live.bytesPerRow
  for y in 0..<h {
    for x in 0..<w {
      let gi = (y * w + x) * 4
      let li = y * rowBytes + x * 4
      let ga = Double(glass[gi + 3]) / 255
      for c in 0..<4 { dst[li + c] = UInt8(min(255, Double(glass[gi + c]) + Double(dst[li + c]) * (1 - ga))) }
    }
  }
  savePNG(live.makeImage()!, "glass-\(name).png")
}

let bar = CGSize(width: 172, height: 60)
let panel = CGSize(width: 360, height: 120)
var clearBar = SanGlassLook()
clearBar.radii = SIMD4(repeating: 30)
render("1-clear-bar-as-today", size: bar, look: clearBar, light: false)
var darkBar = clearBar
darkBar.tint = SIMD4(0, 0, 0, 0.22)
darkBar.shine = 1
render("2-clear-bar-darkened-rim", size: bar, look: darkBar, light: false)
var frosted = SanGlassLook()
frosted.radii = SIMD4(repeating: 24)
frosted.blur = 12
frosted.tint = SIMD4(0.07, 0.07, 0.09, 0.5)
frosted.shine = 0.35
render("3-frosted-panel-dark", size: panel, look: frosted, light: false)
var sheet = frosted
sheet.radii = SIMD4(24, 24, 0, 0)
render("4-frosted-sheet-top-corners", size: panel, look: sheet, light: false)
var lightPanel = frosted
lightPanel.tint = SIMD4(1, 1, 1, 0.55)
render("5-frosted-panel-light", size: panel, look: lightPanel, light: true)
var accent = clearBar
accent.radii = SIMD4(repeating: 19)
accent.tint = SIMD4(0.55, 0.33, 0.75, 0.85)
accent.shine = 1
render("6-accent-pill", size: CGSize(width: 150, height: 38), look: accent, light: false)
print("metal: images written to \(outDir)")
