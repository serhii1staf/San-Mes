import CoreVideo
import ExpoModulesCore
import Metal
import QuartzCore
import UIKit

// MARK: - Shader

/// glisse's lens (`lens.ts` puller with `bezel: true`, the BEND and FINISH shaders of `drawn.ts`),
/// evaluated per pixel. Kept identical to the AGSL version in SanGlassView.kt. Compiled at run time, so
/// a shader problem disables the glass instead of failing the build.
let sanGlassShaderSource = """
#include <metal_stdlib>
using namespace metal;

struct SanGlassOut {
  float4 position [[position]];
  float2 uv;
};

vertex SanGlassOut san_glass_vertex(uint vid [[vertex_id]]) {
  float2 corner = float2(vid == 1 ? 3.0 : -1.0, vid == 2 ? 3.0 : -1.0);
  SanGlassOut o;
  o.position = float4(corner, 0.0, 1.0);
  o.uv = float2((corner.x + 1.0) * 0.5, (1.0 - corner.y) * 0.5);
  return o;
}

struct SanGlassUniforms {
  float2 size;
  float radius;
  float depth;
  float reach;
  float split;
  float frost;
  float saturation;
  float unit;
  float most;
};

static float san_sd_round_rect(float2 p, float2 hs, float r) {
  float2 q = abs(p) - hs + float2(r);
  return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

static float san_bezel_raw(float t) {
  t = max(0.004, t);
  float a = 1.0 - t;
  float s = pow(1.0 - a * a * a * a, 0.25);
  float inc = atan((a * a * a) / (s * s * s));
  float refr = asin(sin(inc) / 1.5);
  return tan(inc - refr) * (0.6 + s);
}

static float4 san_tap(texture2d<float> tex, sampler smp, float2 p, float2 size) {
  float2 q = clamp(p, float2(0.5), size - float2(0.5));
  return tex.sample(smp, q / size);
}

static float4 san_soft(texture2d<float> tex, sampler smp, float2 p, float2 size, float frost) {
  if (frost < 0.25) {
    return san_tap(tex, smp, p, size);
  }
  float o = frost * 0.7;
  return (san_tap(tex, smp, p, size) * 2.0
    + san_tap(tex, smp, p + float2(o, o), size)
    + san_tap(tex, smp, p + float2(-o, o), size)
    + san_tap(tex, smp, p + float2(o, -o), size)
    + san_tap(tex, smp, p + float2(-o, -o), size)) / 6.0;
}

fragment float4 san_glass_fragment(SanGlassOut in [[stage_in]],
                                   texture2d<float> under [[texture(0)]],
                                   constant SanGlassUniforms& u [[buffer(0)]]) {
  constexpr sampler smp(coord::normalized, address::clamp_to_edge, filter::linear);
  float2 coord = in.uv * u.size;
  float2 hs = u.size * 0.5;
  float2 x = coord - hs;
  float r = min(u.radius, min(hs.x, hs.y));
  float edge = san_sd_round_rect(x, hs, r);
  if (edge >= 0.0 || -edge >= u.depth) {
    return float4(0.0);
  }
  float rnd = clamp(max(r, u.depth), 0.0, min(hs.x, hs.y));
  float qx = abs(x.x) - hs.x + rnd;
  float qy = abs(x.y) - hs.y + rnd;
  float2 n = float2(0.0, sign(x.y));
  if (qx > 0.0 && qy > 0.0) {
    n = float2(sign(x.x) * qx, sign(x.y) * qy) / length(float2(qx, qy));
  } else if (qx > qy) {
    n = float2(sign(x.x), 0.0);
  }
  float amount = san_bezel_raw(-edge / u.depth) / u.most;
  float2 d = n * (amount * u.reach);
  float4 red = san_soft(under, smp, coord - d * (1.0 + 0.2 * u.split), u.size, u.frost);
  float4 green = san_soft(under, smp, coord - d * (1.0 + 0.1 * u.split), u.size, u.frost);
  float4 blue = san_soft(under, smp, coord - d, u.size, u.frost);
  float4 c = float4(red.r, green.g, blue.b, (red.a + green.a + blue.a) / 3.0);
  float grey = dot(c.rgb, float3(0.2126, 0.7152, 0.0722));
  c.rgb = clamp(mix(float3(grey), c.rgb, float3(u.saturation)), float3(0.0), float3(c.a));
  float edgePt = -edge / u.unit;
  float k = min(min(1.0, amount * 20.0), edgePt);
  k = min(k, clamp(edgePt, 0.0, 1.0));
  return c * k;
}
"""

/// Same layout as `SanGlassUniforms` in the shader: a float2, then eight floats (40 bytes).
struct SanGlassUniforms {
  var size: SIMD2<Float>
  var radius: Float
  var depth: Float
  var reach: Float
  var split: Float
  var frost: Float
  var saturation: Float
  var unit: Float
  var most: Float
}

// MARK: - Renderer (one per process)

final class SanGlassRenderer {
  static let shared: SanGlassRenderer? = SanGlassRenderer()
  static var lastError: String?

  let device: MTLDevice
  let queue: MTLCommandQueue
  let textureCache: CVMetalTextureCache
  let bezelMost: Float
  private(set) var pipeline: MTLRenderPipelineState?

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
    self.bezelMost = SanGlassRenderer.computeBezelMost()

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

  /// Normaliser of glisse's bezel profile: its largest value over the same 256 samples glisse takes.
  private static func computeBezelMost() -> Float {
    var most = 0.0
    for i in 0..<256 {
      let t = max(0.004, Double(i) / 255.0)
      let surface = pow(1.0 - pow(1.0 - t, 4.0), 0.25)
      let incident = atan(pow(1.0 - t, 3.0) / pow(surface, 3.0))
      let refracted = asin(sin(incident) / 1.5)
      most = max(most, tan(incident - refracted) * (0.6 + surface))
    }
    return Float(most)
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

/// San's liquid glass on iOS: what is beneath this view, bent at its rim with glisse's lens.
///
/// Each frame, everything drawn beneath the view (at each ancestor level, the parent's background and
/// the sublayers below this view's branch) is rendered into a small IOSurface-backed buffer covering
/// only the view's own area, at 2x at most, and handed to Metal without a copy. The fragment shader
/// draws only the rim band; the middle stays transparent, so the live content shows through it.
///
/// Cost control, because this runs on the main thread: frames are capped at 60 Hz; the buffer is
/// fingerprinted and Metal is skipped while it is unchanged; after half a second of no change it is
/// sampled at 15 Hz until something moves; and if rendering ever costs more than 2 ms it drops to every
/// other frame. It stops entirely while the view is out of a window (a pushed screen covers the tabs).
public final class SanGlassView: ExpoView {
  var cornerRadius: Double = 0 { didSet { dirty = true } }
  var bend: Double = 1 { didSet { dirty = true } }
  var dispersion: Double = 2 { didSet { dirty = true } }
  var frost: Double = 0.5 { didSet { dirty = true } }
  var saturation: Double = 1.5 { didSet { dirty = true } }
  var depthFraction: Double = 0.3 { didSet { dirty = true } }
  var maxDepth: Double = 36 { didSet { dirty = true } }

  private let metalLayer = CAMetalLayer()
  private var displayLink: CADisplayLink?
  private var buffers: [CVPixelBuffer] = []
  private var bufferIndex = 0
  private var bufferWidth = 0
  private var bufferHeight = 0
  private var lastFingerprint: UInt64 = 0
  private var unchangedFrames = 0
  private var tickCount = 0
  private var dirty = true
  private var captureCost: CFTimeInterval = 0

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
  }

  private func stop() {
    displayLink?.invalidate()
    displayLink = nil
  }

  fileprivate func tick() {
    guard let renderer = SanGlassRenderer.shared, let pipeline = renderer.pipeline else { return }
    guard let window = window, !isHidden, alpha > 0.01, bounds.width >= 2, bounds.height >= 2 else { return }
    if !convert(bounds, to: window).intersects(window.bounds) { return }

    tickCount &+= 1
    let idle = !dirty && unchangedFrames > 30
    let every = idle ? 4 : (captureCost > 0.002 ? 2 : 1)
    if tickCount % every != 0 { return }

    let started = CACurrentMediaTime()
    guard let captured = capture() else { return }
    captureCost = captureCost * 0.9 + (CACurrentMediaTime() - started) * 0.1

    if !dirty && captured.fingerprint == lastFingerprint {
      unchangedFrames += 1
      return
    }
    lastFingerprint = captured.fingerprint
    unchangedFrames = 0
    dirty = false
    draw(captured.buffer, renderer: renderer, pipeline: pipeline)
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

  private func capture() -> (buffer: CVPixelBuffer, fingerprint: UInt64)? {
    let scale = min(window?.screen.scale ?? 2, 2)
    let width = max(1, Int((bounds.width * scale).rounded(.up)))
    let height = max(1, Int((bounds.height * scale).rounded(.up)))
    if width != bufferWidth || height != bufferHeight || buffers.count < 2 {
      // Two buffers, used in turn, so the CPU never draws into the one the GPU may still be reading.
      buffers.removeAll()
      for _ in 0..<2 {
        guard let made = makeBuffer(width: width, height: height) else { return nil }
        buffers.append(made)
      }
      bufferWidth = width
      bufferHeight = height
      dirty = true
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
  /// each ancestor's background colour and the sublayers below this view's branch, in z order.
  private func renderBeneath(into context: CGContext) {
    var levels: [(UIView, UIView)] = []
    var child: UIView = self
    while let parent = child.superview {
      levels.append((parent, child))
      child = parent
    }
    let target = layer
    for (parent, branch) in levels.reversed() {
      let parentLayer = parent.layer
      if let colour = parentLayer.backgroundColor, colour.alpha > 0.001 {
        let rect = parentLayer.convert(parentLayer.bounds, to: target)
        if rect.intersects(bounds) {
          context.saveGState()
          context.setFillColor(colour)
          context.fill(rect)
          context.restoreGState()
        }
      }
      guard let sublayers = parentLayer.sublayers, !sublayers.isEmpty else { continue }
      let ordered = sublayers.enumerated().sorted { lhs, rhs in
        if lhs.element.zPosition != rhs.element.zPosition {
          return lhs.element.zPosition < rhs.element.zPosition
        }
        return lhs.offset < rhs.offset
      }
      for entry in ordered {
        let sublayer = entry.element
        if sublayer === branch.layer { break }
        if sublayer.isHidden || sublayer.opacity < 0.01 { continue }
        let rect = sublayer.convert(sublayer.bounds, to: target)
        if !rect.intersects(bounds) { continue }
        let w = max(sublayer.bounds.width, 0.0001)
        let h = max(sublayer.bounds.height, 0.0001)
        context.saveGState()
        context.translateBy(x: rect.minX, y: rect.minY)
        context.scaleBy(x: rect.width / w, y: rect.height / h)
        context.translateBy(x: -sublayer.bounds.minX, y: -sublayer.bounds.minY)
        if sublayer.opacity < 0.999 {
          context.setAlpha(CGFloat(sublayer.opacity))
        }
        sublayer.render(in: context)
        context.restoreGState()
      }
    }
  }

  // MARK: Draw

  private func draw(_ buffer: CVPixelBuffer, renderer: SanGlassRenderer, pipeline: MTLRenderPipelineState) {
    var cvTexture: CVMetalTexture?
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    guard CVMetalTextureCacheCreateTextureFromImage(
      kCFAllocatorDefault, renderer.textureCache, buffer, nil, .bgra8Unorm, width, height, 0, &cvTexture
    ) == kCVReturnSuccess,
      let madeTexture = cvTexture,
      let texture = CVMetalTextureGetTexture(madeTexture),
      let drawable = metalLayer.nextDrawable(),
      let commandBuffer = renderer.queue.makeCommandBuffer() else { return }

    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = drawable.texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else { return }

    var uniforms = makeUniforms(renderer: renderer)
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
  }

  private func makeUniforms(renderer: SanGlassRenderer) -> SanGlassUniforms {
    let scale = Float(metalLayer.contentsScale)
    let widthPt = Float(bounds.width)
    let heightPt = Float(bounds.height)
    let depthPt = min(Float(depthFraction) * min(widthPt, heightPt), Float(maxDepth))
    let depthPx = max(1, depthPt * scale)
    let size = SIMD2<Float>(Float(metalLayer.drawableSize.width), Float(metalLayer.drawableSize.height))
    return SanGlassUniforms(
      size: size,
      radius: Float(cornerRadius) * scale,
      depth: depthPx,
      reach: Float(bend) * depthPx,
      split: Float(dispersion),
      frost: Float(frost) * scale,
      saturation: Float(saturation),
      unit: scale,
      most: renderer.bezelMost
    )
  }
}
