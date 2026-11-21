package com.sanmes.glass
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
class SanGlassModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SanGlass")
    // AGSL runtime shaders as RenderEffects need Android 13 (API 33).
    Function("isSupported") { SanGlassView.supported }
    Function("lastError") { SanGlassView.lastError }
    // 1: the first binary (bend, dispersion, frost, saturation, one corner radius). 2: tint, rim light,
    // frosted body, a radius per corner, stats. JS uses the glass as a surface only from 2 on, so an
    // over-the-air bundle running on an older binary keeps that binary's look.
    Function("featureLevel") { 2 }
    Function("stats") { SanGlassStats.snapshot() }
    Function("resetStats") { SanGlassStats.reset() }
    // Not glass: the React Native 0.81 touch-sweep leak workaround lives here because this is the
    // app's one native module. See TouchSweeper.
    OnCreate {
      TouchSweeper.install(appContext.currentActivity, appContext)
    }
    OnActivityEntersForeground {
      TouchSweeper.install(appContext.currentActivity, appContext)
    }
    View(SanGlassView::class) {
      Prop("cornerRadius") { view: SanGlassView, value: Float ->
        val r = value.coerceAtLeast(0f)
        view.cornerRadiiDp = floatArrayOf(r, r, r, r)
      }
      // Top-left, top-right, bottom-right, bottom-left, dp. Sent instead of `cornerRadius` when they differ.
      Prop("cornerRadii") { view: SanGlassView, value: List<Double>? ->
        if (value != null && value.size == 4) {
          view.cornerRadiiDp = FloatArray(4) { i -> value[i].toFloat().coerceAtLeast(0f) }
        }
      }
      Prop("bend") { view: SanGlassView, value: Float -> view.bend = value }
      Prop("dispersion") { view: SanGlassView, value: Float -> view.dispersion = value }
      Prop("frost") { view: SanGlassView, value: Float -> view.frostDp = value }
      Prop("saturation") { view: SanGlassView, value: Float -> view.saturation = value }
      Prop("depth") { view: SanGlassView, value: Float -> view.depthFraction = value }
      Prop("maxDepth") { view: SanGlassView, value: Float -> view.maxDepthDp = value }
      Prop("tintColor") { view: SanGlassView, color: Int? -> view.tintColor = color ?: 0 }
      Prop("shine") { view: SanGlassView, value: Float -> view.shine = value }
      Prop("blur") { view: SanGlassView, value: Float -> view.blurDp = value.coerceAtLeast(0f) }
    }
  }
}
