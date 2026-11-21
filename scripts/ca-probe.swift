// Probe: what does CALayer.render(in:) actually do, and what does it cost?
//
// SanGlassView (iOS) captures what is beneath it every frame with CALayer.render(in:) into a small,
// clipped bitmap. Two questions decide whether that is cheap or ruinous on a screen like the profile:
//   1. Does render(in:) call the layers' own drawing code again (delegate draw / drawRect, i.e. text
//      and SVG are re-rasterised on the CPU), or does it reuse the backing stores already on screen?
//   2. Does it skip sublayers that fall outside the context's clip, or walk and draw the whole tree?
// The tree imitates a profile: 300 cards (rounded, clipped container + 4 text layers + 1 image layer).
import CoreGraphics
import CoreText
import Foundation
import QuartzCore

final class TextDelegate: NSObject, CALayerDelegate {
  var draws = 0
  let line: CTLine
  init(_ s: String) {
    let font = CTFontCreateWithName("Helvetica" as CFString, 15, nil)
    let attr = NSAttributedString(string: s, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
    line = CTLineCreateWithAttributedString(attr)
  }
  func draw(_ layer: CALayer, in ctx: CGContext) {
    draws += 1
    ctx.textPosition = CGPoint(x: 4, y: 6)
    CTLineDraw(line, ctx)
  }
}

func makeImage(_ w: Int, _ h: Int) -> CGImage {
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  for y in stride(from: 0, to: h, by: 8) {
    ctx.setFillColor(CGColor(red: CGFloat(y % 255) / 255, green: 0.4, blue: 0.7, alpha: 1))
    ctx.fill(CGRect(x: 0, y: y, width: w, height: 8))
  }
  return ctx.makeImage()!
}

let image = makeImage(400, 400)
let root = CALayer()
root.frame = CGRect(x: 0, y: 0, width: 393, height: 300 * 130)
var delegates: [TextDelegate] = []
for i in 0..<300 {
  let card = CALayer()
  card.frame = CGRect(x: 16, y: CGFloat(i) * 130, width: 361, height: 120)
  card.backgroundColor = CGColor(gray: 0.15, alpha: 1)
  card.cornerRadius = 28
  card.masksToBounds = true
  for j in 0..<4 {
    let t = CALayer()
    t.frame = CGRect(x: 120, y: 10 + CGFloat(j) * 26, width: 230, height: 24)
    t.contentsScale = 2
    let d = TextDelegate("Card \(i) line \(j): some text that CoreText lays out")
    t.delegate = d
    delegates.append(d)
    card.addSublayer(t)
  }
  let img = CALayer()
  img.frame = CGRect(x: 10, y: 10, width: 100, height: 100)
  img.contents = image
  img.contentsGravity = .resizeAspectFill
  img.cornerRadius = 20
  img.masksToBounds = true
  card.addSublayer(img)
  root.addSublayer(card)
}
// Give every text layer a backing store, as it would have on screen.
for card in root.sublayers! { for s in card.sublayers! where s.delegate != nil { s.setNeedsDisplay(); s.displayIfNeeded() } }
let initialDraws = delegates.reduce(0) { $0 + $1.draws }
func resetDraws() { for d in delegates { d.draws = 0 } }
func totalDraws() -> Int { delegates.reduce(0) { $0 + $1.draws } }

// The glass: 172 x 60 pt, 2x, over the middle of the screen (y 700), like the tab bar over a card.
let target = CGRect(x: 110, y: 700, width: 172, height: 60)
func smallContext() -> CGContext {
  let ctx = CGContext(data: nil, width: 344, height: 120, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  ctx.translateBy(x: 0, y: 120)
  ctx.scaleBy(x: 2, y: -2)
  ctx.translateBy(x: -target.minX, y: -target.minY)
  ctx.clip(to: target)
  return ctx
}
func median(_ xs: [Double]) -> Double { let s = xs.sorted(); return s[s.count / 2] }
func time(_ runs: Int, _ body: () -> Void) -> Double {
  var xs: [Double] = []
  for _ in 0..<runs { let t0 = CACurrentMediaTime(); body(); xs.append((CACurrentMediaTime() - t0) * 1000) }
  return median(xs)
}

print("probe: \(ProcessInfo.processInfo.operatingSystemVersionString), layers \(1 + 300 * 6), initial draws \(initialDraws)")

resetDraws()
let ctx1 = smallContext()
root.render(in: ctx1)
print("A. root.render(in:) into the clipped 172x60 context: delegate draws = \(totalDraws()) of \(delegates.count) text layers")
let tA = time(15) { let c = smallContext(); root.render(in: c) }
print("A. median time \(String(format: "%.2f", tA)) ms")

resetDraws()
let tB = time(15) {
  let c = smallContext()
  for card in root.sublayers! where card.frame.intersects(target) {
    c.saveGState()
    c.translateBy(x: card.frame.minX, y: card.frame.minY)
    card.render(in: c)
    c.restoreGState()
  }
}
print("B. culled (render only the cards that intersect): delegate draws over 15 runs = \(totalDraws()), median time \(String(format: "%.3f", tB)) ms")

// Same tree, layers without delegates: text pre-rendered into CGImage contents (what a layer shows
// once its backing store exists, if render(in:) used it).
for card in root.sublayers! {
  for s in card.sublayers! where s.delegate != nil {
    let c = CGContext(data: nil, width: 460, height: 48, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    c.scaleBy(x: 2, y: 2)
    (s.delegate as! TextDelegate).draw(s, in: c)
    s.delegate = nil
    s.contents = c.makeImage()
  }
}
let tC = time(15) { let c = smallContext(); root.render(in: c) }
print("C. root.render(in:) when every layer has CGImage contents and no delegate: median \(String(format: "%.2f", tC)) ms")
print("D. ratio A/B = \(String(format: "%.0f", tA / max(tB, 0.0001)))x")
