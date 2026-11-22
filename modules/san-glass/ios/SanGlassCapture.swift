import CoreGraphics
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
/// shapes: everything that has real content) to `render(in:)`, which reuses their backing stores. A
/// container that uses something this does not reproduce (its own contents, a shadow, a non-path mask,
/// filters, a sublayer transform) is handed to `render(in:)` whole, so nothing is lost, only not culled.
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
      layer.render(in: ctx)
      let took = CACurrentMediaTime() - started
      counts.renderTime += took
      if took > counts.slowestTime {
        counts.slowestTime = took
        counts.slowestLayer = layer
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
