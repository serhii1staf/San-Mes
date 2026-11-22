import ExpoModulesCore
import UIKit

public final class SanGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SanGlass")

    // Touching `shared` also starts the shader compile, off the main thread, so it is ready by the time
    // the first glass view needs it.
    Function("isSupported") { () -> Bool in
      return SanGlassRenderer.shared != nil
    }

    Function("lastError") { () -> String? in
      return SanGlassRenderer.lastError
    }

    // 1: the first binary (bend, dispersion, frost, saturation, one corner radius). 2: tint, rim light,
    // frosted body, a radius per corner, stats. JS uses the glass as a surface only from 2 on, so an
    // over-the-air bundle running on an older binary keeps that binary's look.
    Function("featureLevel") { () -> Int in
      return 2
    }

    Function("stats") { () -> [String: Any] in
      return SanGlassStats.snapshot()
    }

    Function("resetStats") {
      SanGlassStats.reset()
    }

    View(SanGlassView.self) {
      Prop("cornerRadius") { (view: SanGlassView, value: Double) in
        view.look.radii = SIMD4<Float>(repeating: Float(max(0, value)))
      }
      // Top-left, top-right, bottom-right, bottom-left, pt. Sent instead of `cornerRadius` when they differ.
      Prop("cornerRadii") { (view: SanGlassView, value: [Double]?) in
        guard let radii = value, radii.count == 4 else { return }
        view.look.radii = SIMD4<Float>(
          Float(max(0, radii[0])), Float(max(0, radii[1])), Float(max(0, radii[2])), Float(max(0, radii[3]))
        )
      }
      Prop("bend") { (view: SanGlassView, value: Double) in
        view.look.bend = Float(value)
      }
      Prop("dispersion") { (view: SanGlassView, value: Double) in
        view.look.dispersion = Float(value)
      }
      Prop("frost") { (view: SanGlassView, value: Double) in
        view.look.frost = Float(value)
      }
      Prop("saturation") { (view: SanGlassView, value: Double) in
        view.look.saturation = Float(value)
      }
      Prop("depth") { (view: SanGlassView, value: Double) in
        view.look.depthFraction = Float(value)
      }
      Prop("maxDepth") { (view: SanGlassView, value: Double) in
        view.look.maxDepth = Float(value)
      }
      Prop("tintColor") { (view: SanGlassView, color: UIColor?) in
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        if let color = color, color.getRed(&r, green: &g, blue: &b, alpha: &a) {
          view.look.tint = SIMD4<Float>(Float(r), Float(g), Float(b), Float(a))
        } else {
          view.look.tint = SIMD4<Float>(repeating: 0)
        }
      }
      Prop("shine") { (view: SanGlassView, value: Double) in
        view.look.shine = Float(value)
      }
      Prop("blur") { (view: SanGlassView, value: Double) in
        view.look.blur = Float(max(0, value))
      }
    }
  }
}
