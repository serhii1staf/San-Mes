package com.sanmes.glass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SanGlassModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SanGlass")

    // AGSL runtime shaders as RenderEffects need Android 13 (API 33).
    Function("isSupported") { SanGlassView.supported }

    Function("lastError") { SanGlassView.lastError }

    // Not glass: the React Native 0.81 touch-sweep leak workaround lives here because this is the
    // app's one native module. See TouchSweeper.
    OnCreate {
      TouchSweeper.install(appContext.currentActivity, appContext)
    }
    OnActivityEntersForeground {
      TouchSweeper.install(appContext.currentActivity, appContext)
    }

    View(SanGlassView::class) {
      Prop("cornerRadius") { view: SanGlassView, value: Float -> view.cornerRadiusDp = value }
      Prop("bend") { view: SanGlassView, value: Float -> view.bend = value }
      Prop("dispersion") { view: SanGlassView, value: Float -> view.dispersion = value }
      Prop("frost") { view: SanGlassView, value: Float -> view.frostDp = value }
      Prop("saturation") { view: SanGlassView, value: Float -> view.saturation = value }
      Prop("depth") { view: SanGlassView, value: Float -> view.depthFraction = value }
      Prop("maxDepth") { view: SanGlassView, value: Float -> view.maxDepthDp = value }
    }
  }
}
