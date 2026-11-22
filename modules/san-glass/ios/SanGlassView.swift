import CoreVideo
import ExpoModulesCore
import Metal
import MetalPerformanceShaders
import QuartzCore
import UIKit

// MARK: - Renderer (one per process)

final class SanGlassRenderer {
  static let shared: SanGlassRenderer? = SanGlassRenderer()
  static var lastError: String?

  let device: MTLDevice
  let queue: MTLCommandQueue
  let textureCache: CVMetalTextureCache
  /// Frosted glass blurs its capture with Metal Performance Shaders; without it a frosted glass falls
  /// back to the rim's soft taps.
  let supportsBlur: Bool
  private(set) var pipeline: MTLRenderPipelineState?
  private var blurs: [Float: MPSImageGaussianBlur] = [:]

  private init?() {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      return nil
    }
    var cache: CVMetalTextureCache?
    guard CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &cache) == kCVReturnSuccess,
          let madeCache = cache else {
      return nil
    }
    self.device = device
    self.queue = queue
    self.textureCache = madeCache
    self.supportsBlur = MPSSupportsMTLDevice(device)

    device.makeLibrary(source: sanGlassShaderSource, options: nil) { [weak self] library, error in
      guard let self = self else { return }
      guard let library = library,
            let vertex = library.makeFunction(name: "san_glass_vertex"),
            let fragment = library.makeFunction(name: "san_glass_fragment") else {
        let message = error.map { "\($0)" } ?? "the glass shader did not compile"
        DispatchQueue.main.async { SanGlassRenderer.lastError = message }
        return
      }
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = vertex
      descriptor.fragmentFunction = fragment
      descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
      do {
        let state = try self.device.makeRenderPipelineState(descriptor: descriptor)
        DispatchQueue.main.async { self.pipeline = state }
      } catch {
        let message = "\(error)"
        DispatchQueue.main.async { SanGlassRenderer.lastError = message }
      }
    }
  }

  /// A Gaussian blur of `sigma` capture pixels, made once per (quarter-pixel) sigma. Main thread only.
  func blur(sigma: Float) -> MPSImageGaussianBlur? {
    guard supportsBlur, sigma >= 0.5 else { return nil }
    let key = (sigma * 4).rounded() / 4
    if let made = blurs[key] { return made }
    let made = MPSImageGaussianBlur(device: device, sigma: key)
    made.edgeMode = .clamp
    blurs[key] = made
    return made
  }
}

// MARK: - Stats

/// What the glass costs, summed over every instance since the last reset, for the perf monitor
/// (`SanGlass.stats()` in JS). Updated on the main thread, read from the JS thread, hence the lock.
enum SanGlassStats {
  private static let lock = NSLock()
  private static var instances = 0
  private static var ticks = 0
  private static var captures = 0
  private static var captureTime: CFTimeInterval = 0
  private static var captureMax: CFTimeInterval = 0
  private static var draws = 0
  private static var visited = 0
  private static var rendered = 0
  private static var whole = 0
  /// Ticks where the scene signature was unchanged, so no capture ran.
  private static var skips = 0
  /// Inside `render(in:)`, summed; the slowest single call and what it drew; capture buffers made.
  private static var renderTime: CFTimeInterval = 0
  private static var slowestRender: CFTimeInterval = 0
  private static var slowestRenderWhat = ""
  private static var buffersMade = 0
  /// Time spent computing scene signatures (every tick that gets that far).
  private static var signatureTime: CFTimeInterval = 0
  private static var since = CACurrentMediaTime()

  static func attached(_ delta: Int) {
    lock.lock(); instances += delta; lock.unlock()
  }

  static func ticked() {
    lock.lock(); ticks += 1; lock.unlock()
  }

  static func captured(cost: CFTimeInterval, counts: SanGlassCaptureCounts) {
    lock.lock()
    captures += 1
    captureTime += cost
    captureMax = max(captureMax, cost)
    visited += counts.visited
    rendered += counts.rendered
    whole += counts.whole
    renderTime += counts.renderTime
    if counts.slowestTime > slowestRender, let layer = counts.slowestLayer {
      slowestRender = counts.slowestTime
      slowestRenderWhat = SanGlassLayerCapture.describe(layer)
    }
    lock.unlock()
  }

  static func madeBuffers() {
    lock.lock(); buffersMade += 1; lock.unlock()
  }

  static func drew() {
    lock.lock(); draws += 1; lock.unlock()
  }

  static func signed(cost: CFTimeInterval, skipped: Bool) {
    lock.lock()
    signatureTime += cost
    if skipped { skips += 1 }
    lock.unlock()
  }

  static func snapshot() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    let seconds = max(0.001, CACurrentMediaTime() - since)
    let perCapture = { (n: Int) -> Double in captures > 0 ? Double(n) / Double(captures) : 0 }
    return [
      "seconds": seconds,
      "instances": instances,
      "ticksPerSecond": Double(ticks) / seconds,
      "capturesPerSecond": Double(captures) / seconds,
      "drawsPerSecond": Double(draws) / seconds,
      "captureMsAverage": captures > 0 ? captureTime * 1000 / Double(captures) : 0,
      "captureMsMax": captureMax * 1000,
      // Main-thread time spent capturing, per second of wall time: the glass's share of the UI thread.
      "captureMsPerSecond": captureTime * 1000 / seconds,
      "layersVisitedPerCapture": perCapture(visited),
      "layersRenderedPerCapture": perCapture(rendered),
      "subtreesRenderedWholePerCapture": perCapture(whole),
      // Captures avoided because nothing beneath had changed, and what finding that out cost.
      "skipsPerSecond": Double(skips) / seconds,
      "signatureMsPerSecond": signatureTime * 1000 / seconds,
      // Where a capture's time goes: inside render(in:) (the rest is buffers, context, fingerprint),
      // and the slowest single render(in:) with the layer it drew.
      "renderMsPerCapture": captures > 0 ? renderTime * 1000 / Double(captures) : 0,
      "slowestRenderMs": slowestRender * 1000,
      "slowestRender": slowestRenderWhat,
      "buffersMadePerSecond": Double(buffersMade) / seconds,
    ]
  }

  static func reset() {
    lock.lock()
    ticks = 0
    captures = 0
    captureTime = 0
    captureMax = 0
    draws = 0
    visited = 0
    rendered = 0
    whole = 0
    skips = 0
    signatureTime = 0
    renderTime = 0
    slowestRender = 0
    slowestRenderWhat = ""
    buffersMade = 0
    since = CACurrentMediaTime()
    lock.unlock()
  }
}

// MARK: - Display link without a retain cycle

private final class SanGlassDisplayLinkProxy: NSObject {
  weak var target: SanGlassView?

  init(_ target: SanGlassView) {
    self.target = target
  }

  @objc func tick(_ link: CADisplayLink) {
    target?.tick()
  }
}

// MARK: - View

/// San's liquid glass on iOS: what is beneath this view, bent at its rim with glisse's lens, optionally
/// frosted, tinted and lit at the rim.
///
/// Each frame, everything drawn beneath the view (at each ancestor level, the parent's background and
/// the sublayers below this view's branch) is rendered into a small IOSurface-backed buffer covering
/// only the view's own area and handed to Metal without a copy. Only the parts of the layer tree that
/// can reach that area are visited (`SanGlassLayerCapture`); the first version rendered whole sibling
/// subtrees, so a tab bar paid for every layer of the screen next to it, every frame.
///
/// Clear glass (no blur) is captured at up to 2x and draws only its rim band and tint; the middle is
/// the live content. Frosted glass (`blur` > 0) is captured at 1x or 0.5x (the blur removes the detail a
/// sharper capture would pay for), blurred with Metal Performance Shaders and drawn whole.
///
/// Cost control, because the capture runs on the main thread: frames are capped at 60 Hz; before each
/// capture a cheap signature of the layers beneath (`SanGlassLayerCapture.signature`) is compared with
/// the last one, and while it is unchanged nothing is captured, apart from one capture every
/// `backstopInterval` for what the signature cannot see; the buffer is fingerprinted and Metal is
/// skipped while the pixels are unchanged; if capturing costs more than 2 ms it drops to every other
/// frame while the scene moves. It does nothing while the view is out of a window, off screen, hidden
/// or transparent through any ancestor (a frost that is faded out costs nothing).
public final class SanGlassView: ExpoView {
  var look = SanGlassLook() {
    didSet {
      dirty = true
      if look.blur != oldValue.blur { buffersValid = false }
    }
  }

  private let metalLayer = CAMetalLayer()
  private let layerCapture = SanGlassLayerCapture()
  private var displayLink: CADisplayLink?
  private var buffers: [CVPixelBuffer] = []
  private var buffersValid = false
  private var bufferIndex = 0
  private var bufferWidth = 0
  private var bufferHeight = 0
  private var captureScale: CGFloat = 2
  private var blurTarget: MTLTexture?
  private var lastFingerprint: UInt64 = 0
  private var tickCount = 0
  private var dirty = true
  private var captureCost: CFTimeInterval = 0
  private var attached = false
  /// The scene signature at the last capture, and when that capture ran.
  private var lastSignature: UInt64 = 0
  private var lastCaptureAt: CFTimeInterval = 0
  /// Consecutive checked ticks on which the signature matched the last capture's.
  private var quietTicks = 0
  /// How long an unchanged signature may go without a real capture: the longest a backing store
  /// redrawn in place (which the signature cannot see) can take to show in the glass. 1 s since build
  /// 104: at 0.5 s the backstop alone was 12 captures (50 ms of main thread) per second in a chat.
  private static let backstopInterval: CFTimeInterval = 1.0

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    isOpaque = false
    backgroundColor = .clear
    if let renderer = SanGlassRenderer.shared {
      metalLayer.device = renderer.device
      metalLayer.pixelFormat = .bgra8Unorm
      metalLayer.framebufferOnly = true
      metalLayer.isOpaque = false
      metalLayer.backgroundColor = UIColor.clear.cgColor
      layer.addSublayer(metalLayer)
    }
  }

  deinit {
    displayLink?.invalidate()
    if attached { SanGlassStats.attached(-1) }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    let scale = window?.screen.scale ?? UIScreen.main.scale
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    metalLayer.frame = bounds
    metalLayer.contentsScale = scale
    metalLayer.drawableSize = CGSize(
      width: max(1, (bounds.width * scale).rounded()),
      height: max(1, (bounds.height * scale).rounded())
    )
    CATransaction.commit()
    dirty = true
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      start()
    } else {
      stop()
    }
  }

  private func start() {
    guard displayLink == nil, SanGlassRenderer.shared != nil else { return }
    let link = CADisplayLink(target: SanGlassDisplayLinkProxy(self), selector: #selector(SanGlassDisplayLinkProxy.tick(_:)))
    if #available(iOS 15.0, *) {
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
    } else {
      link.preferredFramesPerSecond = 60
    }
    link.add(to: .main, forMode: .common)
    displayLink = link
    dirty = true
    if !attached {
      attached = true
      SanGlassStats.attached(1)
    }
  }

  private func stop() {
    displayLink?.invalidate()
    displayLink = nil
    if attached {
      attached = false
      SanGlassStats.attached(-1)
    }
  }

  /// Hidden, or transparent through this view or any ancestor: nothing of the glass would be seen.
  private func effectivelyVisible() -> Bool {
    var alpha: CGFloat = 1
    var view: UIView? = self
    while let current = view {
      if current.isHidden { return false }
      alpha *= current.alpha
      if alpha < 0.01 { return false }
      view = current.superview
    }
    return true
  }

  fileprivate func tick() {
    guard let renderer = SanGlassRenderer.shared, let pipeline = renderer.pipeline else { return }
    guard let window = window, bounds.width >= 2, bounds.height >= 2, effectivelyVisible() else { return }
    if !convert(bounds, to: window).intersects(window.bounds) { return }
    SanGlassStats.ticked()

    tickCount &+= 1
    let now = CACurrentMediaTime()
    let backstopDue = now - lastCaptureAt >= Self.backstopInterval
    // Quiet for half a second: look at the scene on every 4th frame only (15 Hz). Measured on an
    // iPhone (build 103, a chat, 6 glass views), a signature costs ~0.3 ms and checking every frame
    // was 99 ms of main thread per second, twice what the captures themselves cost. A change is
    // then noticed within 3 frames, which is how fast the pre-103 idle sampling reacted, and checking
    // goes back to every frame until it is quiet again.
    if !dirty && !backstopDue && quietTicks >= 30 && tickCount % 4 != 0 {
      SanGlassStats.signed(cost: 0, skipped: true)
      return
    }
    // Nothing beneath changed since the last capture: skip it, unless the backstop is due.
    let signature = sceneSignature()
    let signed = CACurrentMediaTime()
    let unchanged = !dirty && signature == lastSignature
    quietTicks = unchanged ? quietTicks + 1 : 0
    let skip = unchanged && !backstopDue
    SanGlassStats.signed(cost: signed - now, skipped: skip)
    if skip { return }
    // While the scene moves, an expensive capture runs every other frame.
    if !unchanged && captureCost > 0.002 && tickCount % 2 != 0 { return }

    let started = CACurrentMediaTime()
    guard let captured = capture() else { return }
    let cost = CACurrentMediaTime() - started
    captureCost = captureCost * 0.9 + cost * 0.1
    SanGlassStats.captured(cost: cost, counts: layerCapture.counts)
    lastSignature = signature
    lastCaptureAt = now

    if !dirty && captured.fingerprint == lastFingerprint { return }
    lastFingerprint = captured.fingerprint
    dirty = false
    draw(captured.buffer, renderer: renderer, pipeline: pipeline)
  }

  /// A signature of everything `renderBeneath` would draw, over the same levels, plus this view's own
  /// size and its place in each ancestor. See `SanGlassLayerCapture.signature`.
  private func sceneSignature() -> UInt64 {
    var h = SanGlassLayerCapture.signatureSeed
    layerCapture.target = layer.bounds
    SanGlassLayerCapture.mix(&h, layer.bounds.width)
    SanGlassLayerCapture.mix(&h, layer.bounds.height)
    var toAncestor = CGAffineTransform.identity
    var child: CALayer = layer
    while let parent = child.superlayer {
      toAncestor = toAncestor.concatenating(SanGlassLayerCapture.layerToSuperlayer(child))
      let parentToGlass = toAncestor.inverted()
      SanGlassLayerCapture.mix(&h, object: parent)
      SanGlassLayerCapture.mix(&h, parentToGlass)
      SanGlassLayerCapture.mix(&h, color: parent.backgroundColor)
      if let sublayers = parent.sublayers {
        for sublayer in SanGlassLayerCapture.drawingOrder(sublayers) {
          if sublayer === child { break }
          layerCapture.signature(sublayer, parentToTarget: parentToGlass, into: &h)
        }
      }
      child = parent
    }
    return h
  }

  // MARK: Capture

  private func makeBuffer(width: Int, height: Int) -> CVPixelBuffer? {
    let attributes: [String: Any] = [
      kCVPixelBufferMetalCompatibilityKey as String: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
      kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
    ]
    var buffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attributes as CFDictionary, &buffer)
    return status == kCVReturnSuccess ? buffer : nil
  }

  /// Pixels per point of the capture. Frosted glass: 1x or 0.5x, since its blur removes the detail a
  /// sharper capture would pay for. Clear glass shows its capture only in the rim band, sharp: up to 2x,
  /// but within about 48,000 pixels. Rasterising what is beneath is most of a capture's cost once the
  /// tree is culled (macOS probe: a 250 x 260 pt menu cost 5.8 ms at 2x and 0.6 ms at 0.5x), and a big
  /// surface's band is wide enough to take less. The tab bar (172 x 60 pt) stays at 2x.
  private func preferredCaptureScale() -> CGFloat {
    let screen = window?.screen.scale ?? 2
    if look.blur >= 6 { return 0.5 }
    if look.blur >= 2 { return 1 }
    let area = max(1, bounds.width * bounds.height)
    return max(1, min(min(screen, 2), (48_000 / area).squareRoot()))
  }

  private func capture() -> (buffer: CVPixelBuffer, fingerprint: UInt64)? {
    let scale = preferredCaptureScale()
    let width = max(1, Int((bounds.width * scale).rounded(.up)))
    let height = max(1, Int((bounds.height * scale).rounded(.up)))
    if !buffersValid || width != bufferWidth || height != bufferHeight || buffers.count < 2 {
      // Two buffers, used in turn, so the CPU never draws into the one the GPU may still be reading.
      buffers.removeAll()
      for _ in 0..<2 {
        guard let made = makeBuffer(width: width, height: height) else { return nil }
        buffers.append(made)
      }
      bufferWidth = width
      bufferHeight = height
      captureScale = scale
      blurTarget = nil
      buffersValid = true
      dirty = true
      SanGlassStats.madeBuffers()
    }
    bufferIndex = (bufferIndex + 1) % buffers.count
    let buffer = buffers[bufferIndex]

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
    let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    guard let context = CGContext(
      data: base,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: bitmapInfo
    ) else { return nil }

    context.clear(CGRect(x: 0, y: 0, width: width, height: height))
    // Layer coordinates run downwards; a bitmap context's run upwards.
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: CGFloat(width) / bounds.width, y: -CGFloat(height) / bounds.height)
    context.translateBy(x: -bounds.minX, y: -bounds.minY)
    context.clip(to: bounds)
    renderBeneath(into: context)

    // FNV-1a over every fifth pixel: enough to tell a changed frame from an unchanged one.
    let words = base.assumingMemoryBound(to: UInt32.self)
    let count = (bytesPerRow / 4) * height
    var hash: UInt64 = 14_695_981_039_346_656_037
    var i = 0
    while i < count {
      hash = (hash ^ UInt64(words[i])) &* 1_099_511_628_211
      i += 5
    }
    return (buffer, hash)
  }

  /// Renders, in this view's coordinates, everything that is drawn beneath it: from the window down,
  /// each ancestor's background and the sublayers below this view's branch, in z order, visiting only
  /// what can reach this view's area.
  private func renderBeneath(into context: CGContext) {
    var levels: [(parent: CALayer, branch: CALayer, glassToParent: CGAffineTransform)] = []
    var toAncestor = CGAffineTransform.identity
    var child: CALayer = layer
    while let parent = child.superlayer {
      toAncestor = toAncestor.concatenating(SanGlassLayerCapture.layerToSuperlayer(child))
      levels.append((parent, child, toAncestor))
      child = parent
    }
    layerCapture.target = layer.bounds
    layerCapture.resetCounts()
    for level in levels.reversed() {
      let parentToGlass = level.glassToParent.inverted()
      context.saveGState()
      context.concatenate(parentToGlass)
      SanGlassLayerCapture.drawBackground(of: level.parent, in: context)
      if let sublayers = level.parent.sublayers {
        for sublayer in SanGlassLayerCapture.drawingOrder(sublayers) {
          if sublayer === level.branch { break }
          layerCapture.draw(sublayer, parentToTarget: parentToGlass, in: context)
        }
      }
      context.restoreGState()
    }
  }

  // MARK: Draw

  private func blurDestination(width: Int, height: Int, device: MTLDevice) -> MTLTexture? {
    if let made = blurTarget, made.width == width, made.height == height { return made }
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
    descriptor.usage = [.shaderRead, .shaderWrite]
    descriptor.storageMode = .private
    blurTarget = device.makeTexture(descriptor: descriptor)
    return blurTarget
  }

  private func draw(_ buffer: CVPixelBuffer, renderer: SanGlassRenderer, pipeline: MTLRenderPipelineState) {
    var cvTexture: CVMetalTexture?
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    guard CVMetalTextureCacheCreateTextureFromImage(
      kCFAllocatorDefault, renderer.textureCache, buffer, nil, .bgra8Unorm, width, height, 0, &cvTexture
    ) == kCVReturnSuccess,
      let madeTexture = cvTexture,
      let source = CVMetalTextureGetTexture(madeTexture),
      let commandBuffer = renderer.queue.makeCommandBuffer() else { return }

    var texture = source
    if look.blur > 0,
       let blur = renderer.blur(sigma: look.blur * Float(captureScale)),
       let destination = blurDestination(width: width, height: height, device: renderer.device) {
      blur.encode(commandBuffer: commandBuffer, sourceTexture: source, destinationTexture: destination)
      texture = destination
    }
    guard let drawable = metalLayer.nextDrawable() else { return }

    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = drawable.texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else { return }

    let size = SIMD2<Float>(Float(metalLayer.drawableSize.width), Float(metalLayer.drawableSize.height))
    var uniforms = look.uniforms(size: size, scale: Float(metalLayer.contentsScale), most: SanGlassBezel.most)
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentTexture(texture, index: 0)
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<SanGlassUniforms>.stride, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()

    // The CoreVideo texture must outlive the GPU's use of it.
    commandBuffer.addCompletedHandler { _ in
      withExtendedLifetime(madeTexture) {}
    }
    commandBuffer.present(drawable)
    commandBuffer.commit()
    SanGlassStats.drew()
  }
}
