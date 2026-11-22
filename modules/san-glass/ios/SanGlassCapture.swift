import CoreGraphics
import Foundation
import QuartzCore

/// Counters for one capture, summed into `SanGlassStats` by the view.
struct SanGlassCaptureCounts {
  /// Layers looked at.
  var visited = 0
  /// `render(in:)` calls: leaves, and subtrees drawn whole (`whole`).
  var rendered = 0
  /// Subtrees drawn whole because they use something this renderer does not reproduce itself.
  var whole = 0
  /// Time inside `render(in:)` calls, and the single slowest one: what it drew and how long it took.
  /// A diagnostic. On an iPhone a capture in a chat cost ~4.2 ms while the same work on the macOS probe,
  /// big contents included, costs 0.01-0.05 ms, so the next snapshots name the layer responsible.
  var renderTime: CFTimeInterval = 0
  var slowestTime: CFTimeInterval = 0
  /// Held only until the next capture resets the counts.
  var slowestLayer: CALayer?
  /// Whether that slowest call was a big leaf being rendered into `SanGlassLeafCache` (a one-off).
  var slowestWasMade = false
  /// Time inside `render(in:)` of subtrees drawn whole (part of `renderTime`).
  var wholeTime: CFTimeInterval = 0
  /// Big leaves drawn from `SanGlassLeafCache`, rendered into it first, or not cached (animated, or no
  /// room); and the time spent rendering into it.
  var cacheHits = 0
  var cacheMade = 0
  var cacheRefused = 0
  var cacheMakeTime: CFTimeInterval = 0
}

/// Big leaves (a long message's text, a full-width gradient or photo: layers whose contents is a large
/// bitmap), rendered ONCE into an image kept here and drawn from it by every capture after that.
///
/// ── WHY ───────────────────────────────────────────────────────────────────────────────────────────
///
/// The owner's build-104 snapshots named the cost. In a chat with a long message, one `render(in:)` of
/// `RCTParagraphTextView 284x2893` took 9.5 ms, all six glass views sat over that message, and they
/// captured 70 times a second while the list moved: the glass took 680 ms of every second and the UI
/// ran at 25 fps. On the profile, `LinearGradientView 390x397` took 6.2 ms. On an iPhone that call
/// costs in proportion to the whole contents, not to the few square points the glass needs; the small
/// leaves around them cost almost nothing. On the macOS probe the same call is cheap, so the probe
/// can check this file's pixels but not that cost. Which step inside Core Animation is slow is not
/// visible through public API; drawing a plain bitmap of our own, cropped to what is needed, does not
/// go through it.
///
/// So a leaf whose contents has at least `minContentsPixels` pixels is rendered once, at the capture's
/// density (0.5, 1 or 2 px per point), and each capture then draws only the part it can see. Shared by
/// every glass view: the header and the composer see the same message.
///
/// ── WHEN AN ENTRY IS RENDERED AGAIN ─────────────────────────────────────────────────────────────────
///
///   - The layer's contents object, size or covered rectangle changed (a new image, a resized view).
///   - The layer is about to redraw its backing store IN PLACE: same object, new pixels. That is how a
///     text view shows an edit, a theme change, or another message when FlashList recycles its cell,
///     and no property says so afterwards. Before it happens the layer reports `needsDisplay()`, and
///     Core Animation redraws it when it commits at the end of the run loop turn. An observer of the
///     main run loop that runs just before that commit (`observeRedraws`) drops the entries of layers
///     about to redraw (`dropRedrawn`).
///   - A sharper image is needed than the one kept (a 2x glass after a 1x one).
///   - It is `maxAge` old: a safety net for a redraw that observer could not see.
///
/// A layer whose entry has to go again within `churnWindow` of being rendered (an animated image, a
/// size animation, text streaming in) is drawn directly for a while instead, longer each time:
/// rendering it whole every frame would cost far more than the direct call.
///
/// Backing stores are cached only for RN's text views (`cachedDrawingClasses`), the case measured; a
/// drawn view that redraws every frame (an animated SVG) would only churn. CGImage contents of any view
/// are cached: replacing an image is always a new object. A CGImage contents is held by its entry, so its
/// address cannot be taken by the next image while the entry lives (expo-image swaps images, and the
/// identity check would then pass for the wrong one). A backing store is not held: it can be large, and
/// it belongs to its layer for the layer's life.
///
/// Bounded by `maxBytes`; least recently used entries go first, never one used in the last half second
/// (that one would only be rendered again next frame). Entries unused for `unusedAge` are dropped, and
/// the view empties the cache on a memory warning, in the background and when no glass is on screen.
/// Main thread only.
final class SanGlassLeafCache {
  enum Outcome { case hit, made, refused }

  /// A cached image of a leaf: it covers `rect`, in the leaf's own coordinates, at `scale` px per point.
  struct Drawable {
    let image: CGImage
    let rect: CGRect
    let scale: CGFloat
  }

  private struct Entry {
    weak var layer: CALayer?
    let contentsID: ObjectIdentifier
    let heldContents: AnyObject?
    let size: CGSize
    let drawable: Drawable
    let bytes: Int
    let made: CFTimeInterval
    var used: CFTimeInterval
  }

  /// A layer drawn directly for now: until when, and how many times it has churned.
  private struct Pause {
    var until: CFTimeInterval
    var strikes: Int
  }

  static let shared = SanGlassLeafCache()
  static let maxBytes = 32 * 1024 * 1024
  /// The most pixels one entry may have: a 284 x 2893 pt message fits at 2x (3.3 million).
  static let maxEntryPixels: CGFloat = 4 * 1024 * 1024
  /// Below this, `render(in:)` measured cheap on the iPhone and the leaf is drawn directly.
  static let minContentsPixels = 500_000
  static let maxAge: CFTimeInterval = 60
  static let churnWindow: CFTimeInterval = 0.5
  /// The first pause; each further churn doubles it, up to `maxPause`. Forgotten after a calm minute.
  static let churnPause: CFTimeInterval = 3
  static let maxPause: CFTimeInterval = 30
  static let unusedAge: CFTimeInterval = 10
  /// Views whose backing store (contents that is not a CGImage) may be cached: RN's text view. The
  /// macOS probe adds its own text delegate.
  static var cachedDrawingClasses: [AnyClass] = {
    var classes: [AnyClass] = []
    if let text = NSClassFromString("RCTParagraphTextView") { classes.append(text) }
    return classes
  }()

  private static let space = CGColorSpaceCreateDeviceRGB()
  private static let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue

  private var entries: [ObjectIdentifier: Entry] = [:]
  private var paused: [ObjectIdentifier: Pause] = [:]
  private(set) var totalBytes = 0
  /// Entries dropped because their layer was about to redraw, since the view last read it.
  private(set) var redrawDrops = 0
  private var lastTrim: CFTimeInterval = 0
  private var observer: CFRunLoopObserver?

  var count: Int { entries.count }

  /// The rectangle (in `layer`'s coordinates) a cached image of `layer` must cover, or nil when the
  /// leaf is not cached: small contents, a backing store of a view not in `cachedDrawingClasses`, or
  /// something drawn outside any rectangle worked out here (a shadow; contents placed by a gravity that
  /// can overflow an unclipped layer).
  static func cacheRect(for layer: CALayer, contents: AnyObject) -> CGRect? {
    if layer.shadowOpacity > 0 && layer.shadowColor != nil { return nil }
    let bounds = layer.bounds
    guard bounds.width >= 1, bounds.height >= 1 else { return nil }
    let image: CGImage? = CFGetTypeID(contents) == CGImage.typeID ? (contents as! CGImage) : nil
    let pixels: CGFloat
    if let image = image {
      pixels = CGFloat(image.width) * CGFloat(image.height)
    } else {
      pixels = bounds.width * bounds.height * layer.contentsScale * layer.contentsScale
    }
    guard pixels >= CGFloat(minContentsPixels) else { return nil }
    if image == nil {
      guard let owner = layer.delegate as? NSObject,
            cachedDrawingClasses.contains(where: { owner.isKind(of: $0) }) else { return nil }
    }
    if layer.masksToBounds { return bounds }
    switch layer.contentsGravity {
    case .resize, .resizeAspect:
      return bounds
    case .resizeAspectFill:
      // expo-image: the image view inside a clipping view fills it, unclipped itself. A backing store
      // has its layer's shape; an image of another shape overflows the bounds on two sides.
      guard let image = image else { return bounds }
      let cw = CGFloat(image.width) * layer.contentsRect.width
      let ch = CGFloat(image.height) * layer.contentsRect.height
      guard cw > 0, ch > 0 else { return nil }
      let fill = max(bounds.width / cw, bounds.height / ch)
      let drawn = CGSize(width: cw * fill, height: ch * fill)
      return CGRect(x: bounds.midX - drawn.width / 2, y: bounds.midY - drawn.height / 2, width: drawn.width, height: drawn.height)
        .union(bounds)
    default:
      return nil
    }
  }

  /// The cached image of `layer` covering `rect` at `wanted` px per point or sharper, rendering it first
  /// when needed; nil when the leaf should be drawn directly.
  func drawable(
    for layer: CALayer, contents: AnyObject, rect: CGRect, scale wanted: CGFloat, now: CFTimeInterval,
    outcome: inout Outcome
  ) -> Drawable? {
    if now - lastTrim >= 1 { trim(now: now) }
    let id = ObjectIdentifier(layer)
    if let pause = paused[id], now < pause.until {
      outcome = .refused
      return nil
    }
    let contentsID = ObjectIdentifier(contents)
    let size = layer.bounds.size
    var keepScale: CGFloat = 0
    if var entry = entries[id], entry.layer === layer {
      if entry.contentsID == contentsID && entry.size == size && entry.drawable.rect == rect {
        if now - entry.made < Self.maxAge && entry.drawable.scale >= wanted * 0.99 {
          entry.used = now
          entries[id] = entry
          outcome = .hit
          return entry.drawable
        }
        keepScale = entry.drawable.scale
      } else if now - entry.made < Self.churnWindow {
        remove(id)
        strike(id, now: now)
        outcome = .refused
        return nil
      }
    }
    remove(id)
    // About to redraw: what it holds now is already out of date.
    if layer.needsDisplay() {
      outcome = .refused
      return nil
    }

    let area = max(1, rect.width * rect.height)
    let scale = min(max(wanted, keepScale), (Self.maxEntryPixels / area).squareRoot())
    let width = Int((rect.width * scale).rounded(.up))
    let height = Int((rect.height * scale).rounded(.up))
    guard scale >= 0.25, width > 0, height > 0, makeRoom(for: width * height * 4, now: now),
          let ctx = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: Self.space, bitmapInfo: Self.bitmapInfo
          ) else {
      outcome = .refused
      return nil
    }
    // As the capture: layer coordinates run downwards, a bitmap context's upwards.
    ctx.translateBy(x: 0, y: CGFloat(height))
    ctx.scaleBy(x: scale, y: -scale)
    ctx.translateBy(x: -rect.minX, y: -rect.minY)
    layer.render(in: ctx)
    guard let image = ctx.makeImage() else {
      outcome = .refused
      return nil
    }
    let drawable = Drawable(image: image, rect: rect, scale: scale)
    let bytes = ctx.bytesPerRow * height
    let held: AnyObject? = CFGetTypeID(contents) == CGImage.typeID ? contents : nil
    entries[id] = Entry(
      layer: layer, contentsID: contentsID, heldContents: held, size: size, drawable: drawable,
      bytes: bytes, made: now, used: now
    )
    totalBytes += bytes
    observeRedraws()
    outcome = .made
    return drawable
  }

  /// Drops the entries of layers about to redraw (see the type's notes), and of layers that are gone.
  func dropRedrawn(now: CFTimeInterval) {
    for (key, entry) in entries {
      guard let layer = entry.layer else {
        remove(key)
        continue
      }
      if layer.needsDisplay() {
        remove(key)
        redrawDrops += 1
        if now - entry.made < Self.churnWindow { strike(key, now: now) }
      }
    }
  }

  /// Returns and clears the count of redraw drops (read by the view after each capture).
  func takeRedrawDrops() -> Int {
    let n = redrawDrops
    redrawDrops = 0
    return n
  }

  /// Drops entries unused for `unusedAge` or whose layer is gone, finished pauses, and the strikes of
  /// layers calm for a minute.
  func trim(now: CFTimeInterval) {
    lastTrim = now
    for (key, entry) in entries where entry.layer == nil || now - entry.used > Self.unusedAge {
      remove(key)
    }
    for (key, pause) in paused where now >= pause.until + 60 {
      paused[key] = nil
    }
  }

  func removeAll() {
    entries.removeAll()
    paused.removeAll()
    totalBytes = 0
  }

  private func remove(_ key: ObjectIdentifier) {
    if let entry = entries.removeValue(forKey: key) { totalBytes -= entry.bytes }
  }

  private func strike(_ key: ObjectIdentifier, now: CFTimeInterval) {
    let strikes = (paused[key]?.strikes ?? 0) + 1
    let length = min(Self.maxPause, Self.churnPause * Double(1 << min(strikes - 1, 8)))
    paused[key] = Pause(until: now + length, strikes: strikes)
  }

  /// Frees room for `bytes` more, least recently used first, never an entry used in the last half second.
  private func makeRoom(for bytes: Int, now: CFTimeInterval) -> Bool {
    if bytes > Self.maxBytes { return false }
    while totalBytes + bytes > Self.maxBytes {
      var victim: ObjectIdentifier?
      var oldest = now - 0.5
      for (key, entry) in entries where entry.used < oldest {
        victim = key
        oldest = entry.used
      }
      guard let key = victim else { return false }
      remove(key)
    }
    return true
  }

  /// Installs, once, the observer that runs `dropRedrawn` on every turn of the main run loop just
  /// before Core Animation commits (its observer has order 2,000,000; UIKit's own before-commit work
  /// runs at 1,999,000). Only installed once something is cached; costs a few comparisons per turn.
  private func observeRedraws() {
    guard observer == nil else { return }
    let activities = CFRunLoopActivity.beforeWaiting.rawValue | CFRunLoopActivity.exit.rawValue
    let made = CFRunLoopObserverCreateWithHandler(kCFAllocatorDefault, activities, true, 1_999_500) { _, _ in
      let cache = SanGlassLeafCache.shared
      if !cache.entries.isEmpty { cache.dropRedrawn(now: CACurrentMediaTime()) }
    }
    CFRunLoopAddObserver(CFRunLoopGetMain(), made, .commonModes)
    observer = made
  }
}

/// Draws what a layer tree shows inside one small rectangle, visiting only the parts of the tree that
/// can reach it.
///
/// ── WHY NOT `render(in:)` ON THE WHOLE SUBTREE ──────────────────────────────────────────────────────
///
/// The glass used to call `CALayer.render(in:)` on every sibling subtree beneath it, into a context
/// clipped to the glass. That walks and draws EVERY layer of the subtree, wherever it is: the clip makes
/// the drawing of a far-away layer cheap, not the visit. Measured on macOS 15 (M1, a 1,801-layer tree
/// shaped like a profile): 5.92 ms per capture into a clipped 172 x 60 pt context, against 0.63 ms
/// when only the cards that reach it are rendered. The tab bar sits next to the whole screen in the
/// hierarchy, so it paid for the whole screen, at up to 60 captures a second, per glass.
///
/// This descends from the top of each subtree, skips any subtree that cannot reach the rectangle, draws
/// a container's own background and border itself, and leaves the leaves (text, images, gradients,
/// shapes: everything that has real content) to `render(in:)`, which reuses their backing stores; a
/// leaf with big contents is drawn from `SanGlassLeafCache` instead (see there). A container that uses
/// something this does not reproduce (its own contents, a shadow, a non-path mask, filters, a sublayer
/// transform) is handed to `render(in:)` whole, so nothing is lost, only not culled.
///
/// Non-clipping containers can show things outside their bounds (offset children, shadows), so their
/// subtrees are skipped only when even `overflowMargin` around their bounds misses the rectangle.
///
/// Pure Core Animation and Core Graphics, no UIKit: the macOS probe (scripts/ca-probe.swift) compiles
/// this same file to check its output against `render(in:)` pixel by pixel.
final class SanGlassLayerCapture {
  /// The rectangle to fill, in "target" coordinates: the space the context's CTM maps to pixels when
  /// `draw` is called.
  var target: CGRect = .zero
  var overflowMargin: CGFloat = 48
  /// Draw big leaves from `SanGlassLeafCache` (the probe turns it off to compare).
  var useLeafCache = true
  private(set) var counts = SanGlassCaptureCounts()

  func resetCounts() {
    counts = SanGlassCaptureCounts()
  }

  /// Fills `layer`'s own background (not its sublayers). The context's CTM must map `layer`'s
  /// coordinates to pixels.
  static func drawBackground(of layer: CALayer, in ctx: CGContext) {
    guard let background = layer.backgroundColor, background.alpha > 0.001 else { return }
    let bounds = layer.bounds
    let radius = min(layer.cornerRadius, min(bounds.width, bounds.height) / 2)
    ctx.addPath(roundedPath(bounds, radius: radius, corners: layer.maskedCorners))
    ctx.setFillColor(background)
    ctx.fillPath()
  }

  /// Strokes `layer`'s own border. Core Animation draws it inside the bounds and ABOVE the sublayers.
  static func drawBorder(of layer: CALayer, in ctx: CGContext) {
    let bounds = layer.bounds
    let radius = min(layer.cornerRadius, min(bounds.width, bounds.height) / 2)
    let width = layer.borderWidth
    if width > 0, let border = layer.borderColor, border.alpha > 0.001 {
      // Core Animation draws the border inside the bounds.
      let inset = bounds.insetBy(dx: width / 2, dy: width / 2)
      ctx.addPath(roundedPath(inset, radius: max(0, radius - width / 2), corners: layer.maskedCorners))
      ctx.setStrokeColor(border)
      ctx.setLineWidth(width)
      ctx.strokePath()
    }
  }

  /// Draws `layer` and what of its subtree reaches the target. On entry the context's CTM maps the
  /// coordinates of `layer`'s SUPERLAYER to pixels, and `parentToTarget` maps them to target coordinates.
  func draw(_ layer: CALayer, parentToTarget: CGAffineTransform, in ctx: CGContext) {
    counts.visited += 1
    if layer.isHidden || layer.opacity < 0.01 { return }
    // GPU-drawn content (another glass, video) is not in the layer tree as pixels; `render(in:)` would
    // draw nothing for it anyway.
    if layer is CAMetalLayer { return }

    let toParent = Self.layerToSuperlayer(layer)
    let toTarget = toParent.concatenating(parentToTarget)
    let bounds = layer.bounds
    let clips = layer.masksToBounds || layer.mask != nil
    var reach = bounds.applying(toTarget)
    if !clips { reach = reach.insetBy(dx: -overflowMargin, dy: -overflowMargin) }
    if !reach.intersects(target) { return }

    let sublayers = layer.sublayers ?? []
    ctx.saveGState()
    ctx.concatenate(toParent)
    defer { ctx.restoreGState() }

    if sublayers.isEmpty || Self.needsWholeRender(layer) {
      if layer.opacity < 0.999 { ctx.setAlpha(CGFloat(layer.opacity)) }
      let started = CACurrentMediaTime()
      var made = false
      let cached = useLeafCache && sublayers.isEmpty
        && drawCached(layer, toTarget: toTarget, in: ctx, now: started, made: &made)
      if !cached { layer.render(in: ctx) }
      let took = CACurrentMediaTime() - started
      counts.renderTime += took
      if !sublayers.isEmpty { counts.wholeTime += took }
      if took > counts.slowestTime {
        counts.slowestTime = took
        counts.slowestLayer = layer
        counts.slowestWasMade = made
      }
      counts.rendered += 1
      if !sublayers.isEmpty { counts.whole += 1 }
      return
    }

    // A container: group opacity like Core Animation's, inside a transparency layer the size of the
    // (small) clip, so overlapping translucent children do not double-darken.
    let group = layer.opacity < 0.999
    if group {
      ctx.setAlpha(CGFloat(layer.opacity))
      ctx.beginTransparencyLayer(auxiliaryInfo: nil)
    }
    Self.drawBackground(of: layer, in: ctx)
    ctx.saveGState()
    if clips {
      if let mask = layer.mask as? CAShapeLayer, let path = mask.path {
        var toLayer = Self.layerToSuperlayer(mask)
        if let transformed = path.copy(using: &toLayer) {
          ctx.addPath(transformed)
          ctx.clip(using: mask.fillRule == .evenOdd ? .evenOdd : .winding)
        }
      } else {
        let radius = min(layer.cornerRadius, min(bounds.width, bounds.height) / 2)
        ctx.addPath(Self.roundedPath(bounds, radius: radius, corners: layer.maskedCorners))
        ctx.clip()
      }
    }
    for sublayer in Self.drawingOrder(sublayers) {
      draw(sublayer, parentToTarget: toTarget, in: ctx)
    }
    ctx.restoreGState()
    Self.drawBorder(of: layer, in: ctx)
    if group { ctx.endTransparencyLayer() }
  }

  /// "RCTParagraphTextView 330x4000 contents +2": the view class owning the layer (or the layer class),
  /// its size in points, whether it has contents, and how many sublayers it has.
  static func describe(_ layer: CALayer) -> String {
    let owner = layer.delegate.map { String(describing: type(of: $0)) } ?? String(describing: type(of: layer))
    var text = "\(owner) \(Int(layer.bounds.width))x\(Int(layer.bounds.height))"
    if layer.contents != nil { text += " contents" }
    let children = layer.sublayers?.count ?? 0
    if children > 0 { text += " +\(children)" }
    return text
  }

  // MARK: Leaf cache

  /// Draws a big leaf from `SanGlassLeafCache`, rendering it into the cache first when needed. False
  /// when the leaf is not cached: the caller renders it directly. The context's CTM maps the leaf's
  /// coordinates to pixels; its alpha already carries the leaf's opacity.
  private func drawCached(
    _ layer: CALayer, toTarget: CGAffineTransform, in ctx: CGContext, now: CFTimeInterval, made: inout Bool
  ) -> Bool {
    guard let contents = layer.contents else { return false }
    let object = contents as AnyObject
    guard let rect = SanGlassLeafCache.cacheRect(for: layer, contents: object) else { return false }
    // Pixels per point at this leaf, in steps, so the glass views over it (2x clear, 1x or 0.5x frosted,
    // a held bubble's 1.04 scale) share one image instead of each making its own.
    let m = ctx.ctm
    let density = abs(m.a * m.d - m.b * m.c).squareRoot()
    let wanted: CGFloat = density <= 0.51 ? 0.5 : (density <= 1.01 ? 1 : 2)
    var outcome = SanGlassLeafCache.Outcome.refused
    guard let drawable = SanGlassLeafCache.shared.drawable(
      for: layer, contents: object, rect: rect, scale: wanted, now: now, outcome: &outcome
    ) else {
      counts.cacheRefused += 1
      return false
    }
    if outcome == .made {
      made = true
      counts.cacheMade += 1
      counts.cacheMakeTime += CACurrentMediaTime() - now
    } else {
      counts.cacheHits += 1
    }
    Self.drawPart(of: drawable, seenBy: target, toTarget: toTarget, in: ctx)
    return true
  }

  /// Draws the part of a cached leaf that `target` can see, cropped first, so the cost follows the
  /// glass's size, not the leaf's. `toTarget` maps the leaf's coordinates to target coordinates; the
  /// context's CTM maps them to pixels.
  static func drawPart(
    of drawable: SanGlassLeafCache.Drawable, seenBy target: CGRect, toTarget: CGAffineTransform, in ctx: CGContext
  ) {
    let rect = drawable.rect
    var need = rect
    if abs(toTarget.a * toTarget.d - toTarget.b * toTarget.c) > 1e-12 {
      need = target.applying(toTarget.inverted()).intersection(rect)
    }
    if need.isNull || need.isEmpty { return }
    let s = drawable.scale
    let image = drawable.image
    let iw = CGFloat(image.width)
    let ih = CGFloat(image.height)
    // In image pixels, with two more on every side, so the interpolation at the edge of what is seen
    // reads the real neighbours rather than the edge of a cropped image.
    let x0 = max(0, ((need.minX - rect.minX) * s).rounded(.down) - 2)
    let y0 = max(0, ((need.minY - rect.minY) * s).rounded(.down) - 2)
    let x1 = min(iw, ((need.maxX - rect.minX) * s).rounded(.up) + 2)
    let y1 = min(ih, ((need.maxY - rect.minY) * s).rounded(.up) + 2)
    guard x1 > x0, y1 > y0 else { return }
    let whole = x0 == 0 && y0 == 0 && x1 == iw && y1 == ih
    guard let part = whole ? image : image.cropping(to: CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)) else {
      return
    }
    // The part's first row is its top; with the CTM running downwards it is drawn flipped back.
    let dest = CGRect(x: rect.minX + x0 / s, y: rect.minY + y0 / s, width: (x1 - x0) / s, height: (y1 - y0) / s)
    ctx.saveGState()
    ctx.translateBy(x: dest.minX, y: dest.maxY)
    ctx.scaleBy(x: 1, y: -1)
    ctx.draw(part, in: CGRect(origin: .zero, size: dest.size))
    ctx.restoreGState()
  }

  // MARK: Signature

  /// Mixes into `h` what `draw` would read for `layer` and the part of its subtree that can reach the
  /// target: identity, placement, size, visibility, and the properties drawn (background, border,
  /// corners, contents identity, shape and gradient parameters). Arguments as for `draw`.
  ///
  /// ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
  ///
  /// The owner's iPhone snapshots showed the glass capturing about 60 times a second in total with
  /// `drawsPerSecond: 0`: nothing beneath had changed, every capture rasterised the same pixels, and
  /// the fingerprint threw them away afterwards. At 2.6 ms (profile) to 5.9 ms (a chat with long
  /// messages) per capture that was 257-352 ms of main thread per second, at rest.
  ///
  /// This walk visits the same culled layers without drawing anything, so comparing two signatures
  /// costs microseconds where a capture costs milliseconds. Equal signatures mean nothing beneath moved,
  /// appeared, disappeared or was restyled. What it cannot see is a backing store redrawn IN PLACE (the
  /// same contents object holding new pixels, e.g. a text view that re-rendered), which is why the view
  /// still captures every `backstopInterval` whatever the signature says.
  ///
  /// `culled` is false inside a subtree that `draw` hands to `render(in:)` whole: that renders all of
  /// it, so all of it is hashed.
  func signature(_ layer: CALayer, parentToTarget: CGAffineTransform, into h: inout UInt64, culled: Bool = true) {
    if layer.isHidden || layer.opacity < 0.01 { return }
    if layer is CAMetalLayer { return }
    let toParent = Self.layerToSuperlayer(layer)
    let toTarget = toParent.concatenating(parentToTarget)
    let clips = layer.masksToBounds || layer.mask != nil
    if culled {
      var reach = layer.bounds.applying(toTarget)
      if !clips { reach = reach.insetBy(dx: -overflowMargin, dy: -overflowMargin) }
      if !reach.intersects(target) { return }
    }
    let bounds = layer.bounds
    Self.mix(&h, object: layer)
    Self.mix(&h, toTarget)
    Self.mix(&h, bounds.origin.x)
    Self.mix(&h, bounds.origin.y)
    Self.mix(&h, bounds.width)
    Self.mix(&h, bounds.height)
    Self.mix(&h, CGFloat(layer.opacity))
    Self.mix(&h, color: layer.backgroundColor)
    Self.mix(&h, layer.cornerRadius)
    Self.mix(&h, UInt64(layer.maskedCorners.rawValue) | (clips ? 1 << 32 : 0))
    Self.mix(&h, layer.borderWidth)
    Self.mix(&h, color: layer.borderColor)
    Self.mix(&h, object: layer.contents.map { $0 as AnyObject })
    if let shape = layer as? CAShapeLayer {
      Self.mix(&h, object: shape.path)
      Self.mix(&h, color: shape.fillColor)
      Self.mix(&h, color: shape.strokeColor)
      Self.mix(&h, shape.lineWidth)
      Self.mix(&h, shape.strokeStart)
      Self.mix(&h, shape.strokeEnd)
    } else if let gradient = layer as? CAGradientLayer {
      // CGColor is immutable, so the objects' identity says whether the colours changed.
      for c in gradient.colors ?? [] { Self.mix(&h, object: c as AnyObject) }
      for l in gradient.locations ?? [] { Self.mix(&h, CGFloat(l.doubleValue)) }
      Self.mix(&h, gradient.startPoint.x)
      Self.mix(&h, gradient.startPoint.y)
      Self.mix(&h, gradient.endPoint.x)
      Self.mix(&h, gradient.endPoint.y)
    } else if let text = layer as? CATextLayer {
      Self.mix(&h, object: text.string.map { $0 as AnyObject })
    }
    if let mask = layer.mask {
      if let shapeMask = mask as? CAShapeLayer { Self.mix(&h, object: shapeMask.path) }
      Self.mix(&h, Self.layerToSuperlayer(mask))
      Self.mix(&h, object: mask.contents.map { $0 as AnyObject })
    }
    let whole = Self.needsWholeRender(layer)
    if whole {
      Self.mix(&h, CGFloat(layer.shadowOpacity))
      Self.mix(&h, layer.shadowRadius)
      Self.mix(&h, layer.shadowOffset.width)
      Self.mix(&h, layer.shadowOffset.height)
      Self.mix(&h, color: layer.shadowColor)
      Self.mix(&h, object: layer.shadowPath)
      Self.mix(&h, UInt64(layer.filters?.count ?? 0))
    }
    guard let sublayers = layer.sublayers, !sublayers.isEmpty else { return }
    Self.mix(&h, UInt64(sublayers.count))
    for sublayer in Self.drawingOrder(sublayers) {
      signature(sublayer, parentToTarget: toTarget, into: &h, culled: culled && !whole)
    }
  }

  /// FNV-1a, 64 bit, over whole words.
  static let signatureSeed: UInt64 = 14_695_981_039_346_656_037

  @inline(__always) static func mix(_ h: inout UInt64, _ v: UInt64) {
    h = (h ^ v) &* 1_099_511_628_211
  }

  @inline(__always) static func mix(_ h: inout UInt64, _ v: CGFloat) {
    mix(&h, Double(v).bitPattern)
  }

  static func mix(_ h: inout UInt64, _ t: CGAffineTransform) {
    mix(&h, t.a)
    mix(&h, t.b)
    mix(&h, t.c)
    mix(&h, t.d)
    mix(&h, t.tx)
    mix(&h, t.ty)
  }

  /// By identity, not by components: CGColor is immutable, so a different object is the only way a
  /// colour can change, and reading `components` allocates an array per call. That was two arrays per
  /// layer per signature. A new object with the same components costs one needless capture.
  static func mix(_ h: inout UInt64, color: CGColor?) {
    mix(&h, object: color)
  }

  static func mix(_ h: inout UInt64, object: AnyObject?) {
    guard let object = object else {
      mix(&h, UInt64(0x5A4E_0000_0000_0002))
      return
    }
    mix(&h, UInt64(UInt(bitPattern: ObjectIdentifier(object))))
  }

  // MARK: Geometry

  /// The affine transform taking `layer`'s coordinates (its bounds space) to its superlayer's: the
  /// anchor point sits at `position`, and `transform` turns about it. A 3D transform is flattened to
  /// its affine part, as `render(in:)` does.
  static func layerToSuperlayer(_ layer: CALayer) -> CGAffineTransform {
    let bounds = layer.bounds
    let anchor = CGPoint(
      x: bounds.minX + layer.anchorPoint.x * bounds.width,
      y: bounds.minY + layer.anchorPoint.y * bounds.height
    )
    var t = CGAffineTransform(translationX: -anchor.x, y: -anchor.y)
    let transform = layer.transform
    if !CATransform3DIsIdentity(transform) {
      t = t.concatenating(CATransform3DGetAffineTransform(transform))
    }
    return t.concatenating(CGAffineTransform(translationX: layer.position.x, y: layer.position.y))
  }

  static func drawingOrder(_ sublayers: [CALayer]) -> [CALayer] {
    var needsSort = false
    for sublayer in sublayers where sublayer.zPosition != 0 {
      needsSort = true
      break
    }
    if !needsSort { return sublayers }
    return sublayers.enumerated().sorted { lhs, rhs in
      lhs.element.zPosition != rhs.element.zPosition ? lhs.element.zPosition < rhs.element.zPosition : lhs.offset < rhs.offset
    }.map { $0.element }
  }

  /// Containers this renderer does not reproduce itself, so they go to `render(in:)` whole.
  static func needsWholeRender(_ layer: CALayer) -> Bool {
    if layer.contents != nil { return true }
    if layer.shadowOpacity > 0 && layer.shadowColor != nil { return true }
    if let mask = layer.mask, !(mask is CAShapeLayer) { return true }
    if !CATransform3DIsIdentity(layer.sublayerTransform) { return true }
    if let filters = layer.filters, !filters.isEmpty { return true }
    if layer.compositingFilter != nil { return true }
    // Layers whose own drawing is more than a background: gradients, shapes, text, replicators.
    if layer is CAGradientLayer || layer is CAShapeLayer || layer is CATextLayer || layer is CAReplicatorLayer {
      return true
    }
    return false
  }

  static func roundedPath(_ rect: CGRect, radius: CGFloat, corners: CACornerMask) -> CGPath {
    let r = max(0, min(radius, min(rect.width, rect.height) / 2))
    if r <= 0.01 { return CGPath(rect: rect, transform: nil) }
    let all: CACornerMask = [.layerMinXMinYCorner, .layerMaxXMinYCorner, .layerMinXMaxYCorner, .layerMaxXMaxYCorner]
    if corners == all { return CGPath(roundedRect: rect, cornerWidth: r, cornerHeight: r, transform: nil) }
    let path = CGMutablePath()
    let tl = corners.contains(.layerMinXMinYCorner) ? r : 0
    let tr = corners.contains(.layerMaxXMinYCorner) ? r : 0
    let br = corners.contains(.layerMaxXMaxYCorner) ? r : 0
    let bl = corners.contains(.layerMinXMaxYCorner) ? r : 0
    path.move(to: CGPoint(x: rect.minX + tl, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX - tr, y: rect.minY))
    if tr > 0 { path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + tr), radius: tr) }
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - br))
    if br > 0 { path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - br, y: rect.maxY), radius: br) }
    path.addLine(to: CGPoint(x: rect.minX + bl, y: rect.maxY))
    if bl > 0 { path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - bl), radius: bl) }
    path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + tl))
    if tl > 0 { path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + tl, y: rect.minY), radius: tl) }
    path.closeSubpath()
    return path
  }
}
