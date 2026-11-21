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
      layer.render(in: ctx)
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
