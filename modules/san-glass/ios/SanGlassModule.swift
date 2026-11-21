import ExpoModulesCore

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

    View(SanGlassView.self) {
      Prop("cornerRadius") { (view: SanGlassView, value: Double) in
        view.cornerRadius = value
      }
      Prop("bend") { (view: SanGlassView, value: Double) in
        view.bend = value
      }
      Prop("dispersion") { (view: SanGlassView, value: Double) in
        view.dispersion = value
      }
      Prop("frost") { (view: SanGlassView, value: Double) in
        view.frost = value
      }
      Prop("saturation") { (view: SanGlassView, value: Double) in
        view.saturation = value
      }
      Prop("depth") { (view: SanGlassView, value: Double) in
        view.depthFraction = value
      }
      Prop("maxDepth") { (view: SanGlassView, value: Double) in
        view.maxDepth = value
      }
    }
  }
}
