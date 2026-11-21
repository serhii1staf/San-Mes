package com.sanmes.glass

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.RuntimeShader
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.annotation.RequiresApi
import com.facebook.react.uimanager.ReactZIndexedViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.tan

/**
 * San's liquid glass on Android: what is beneath this view, bent at its rim with glisse's lens.
 *
 * Every frame (from the window's pre-draw pass, so only when something on screen actually changes),
 * everything drawn BENEATH this view — at each ancestor level, the parent's background and the children
 * that come before this view's branch in drawing order — is recorded into [node] from those views' own
 * display lists. That is a re-recording of draw commands, not a rasterisation: unchanged children are
 * replayed from their existing RenderNodes. [node] carries an AGSL [RuntimeShader] as its RenderEffect,
 * so the GPU bends that content when [onDraw] draws the node. The middle of the glass is transparent;
 * only the rim band is drawn, so the live content shows through there unchanged.
 */
@SuppressLint("ViewConstructor")
class SanGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var cornerRadiusDp = 0f
    set(value) { field = value; uniformsDirty = true; invalidate() }
  var bend = 1f
    set(value) { field = value; uniformsDirty = true; invalidate() }
  var dispersion = 2f
    set(value) { field = value; uniformsDirty = true; invalidate() }
  var frostDp = 0.5f
    set(value) { field = value; uniformsDirty = true; invalidate() }
  var saturation = 1.5f
    set(value) { field = value; uniformsDirty = true; invalidate() }
  var depthFraction = 0.3f
    set(value) { field = value; uniformsDirty = true; invalidate() }
  var maxDepthDp = 36f
    set(value) { field = value; uniformsDirty = true; invalidate() }

  private var uniformsDirty = true
  // Set when this view's own display list must be re-recorded: a new node, or a new effect on it.
  private var needsRedraw = true
  private var node: RenderNode? = null
  private var shader: RuntimeShader? = null
  private var failed = false
  private var recording = false
  private var observer: ViewTreeObserver? = null
  private val visible = Rect()
  private val toSelf = Matrix()
  private val walk = Matrix()
  private val local = Matrix()
  private val levels = ArrayList<Pair<ViewGroup, View>>(24)

  private val preDraw = ViewTreeObserver.OnPreDrawListener {
    capture()
    true
  }

  init {
    setWillNotDraw(false)
    isClickable = false
    isFocusable = false
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (!supported) return
    val vto = viewTreeObserver
    vto.addOnPreDrawListener(preDraw)
    observer = vto
  }

  override fun onDetachedFromWindow() {
    observer?.let { if (it.isAlive) it.removeOnPreDrawListener(preDraw) }
    observer = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) node?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    uniformsDirty = true
  }

  private fun capture() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || failed || recording) return
    // Off screen, collapsed or covered by a pushed screen's window: nothing to bend, and no reason to
    // re-record anything.
    if (!isShown || width < 2 || height < 2 || !getGlobalVisibleRect(visible)) return
    recording = true
    try {
      record()
    } catch (t: Throwable) {
      failed = true
      lastError = t.toString()
    } finally {
      recording = false
    }
    // ── NO invalidate() HERE ────────────────────────────────────────────────────────────────────
    //
    // This runs inside the window's pre-draw pass, so a frame is already being drawn, and this view's
    // display list already draws `node`. Re-recording the node is enough: the RenderThread renders the
    // node's new content (and its effect) in this frame. Invalidating here was a mistake that cost
    // a frame forever: ViewRootImpl clears mWillDrawSoon before dispatching onPreDraw, so an
    // invalidate() from a pre-draw listener schedules ANOTHER traversal, whose pre-draw invalidated
    // again. Measured on the emulator: the static chat list drew 402 frames in 6 s with it, against
    // about 2 per second without the glass. Only a new node or new uniforms need this view redrawn.
    if (needsRedraw) {
      needsRedraw = false
      invalidate()
    }
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun record() {
    val w = width
    val h = height
    val n = node ?: RenderNode("SanGlass").also {
      node = it
      needsRedraw = true
    }
    if (n.width != w || n.height != h) {
      n.setPosition(0, 0, w, h)
      uniformsDirty = true
    }
    if (uniformsDirty) {
      applyUniforms(n, w, h)
      needsRedraw = true
    }
    val canvas = n.beginRecording(w, h)
    try {
      drawBeneath(canvas)
    } finally {
      n.endRecording()
    }
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun applyUniforms(n: RenderNode, w: Int, h: Int) {
    val density = resources.displayMetrics.density
    val shorterDp = min(w, h) / density
    val depthPx = max(1f, min(depthFraction * shorterDp, maxDepthDp) * density)
    val s = shader ?: RuntimeShader(AGSL).also { shader = it }
    s.setFloatUniform("size", w.toFloat(), h.toFloat())
    s.setFloatUniform("radius", cornerRadiusDp * density)
    s.setFloatUniform("depth", depthPx)
    s.setFloatUniform("reach", bend * depthPx)
    s.setFloatUniform("split", dispersion)
    s.setFloatUniform("frost", frostDp * density)
    s.setFloatUniform("saturation", saturation)
    s.setFloatUniform("unit", density)
    s.setFloatUniform("most", BEZEL_MOST)
    n.setRenderEffect(RenderEffect.createRuntimeShaderEffect(s, "under"))
    uniformsDirty = false
  }

  /**
   * Records, in this view's coordinates, everything that is drawn beneath it: from the root down, each
   * ancestor's background and the children that come before this view's branch in drawing order.
   */
  private fun drawBeneath(canvas: Canvas) {
    levels.clear()
    var child: View = this
    var parent = child.parent
    while (parent is ViewGroup) {
      levels.add(parent to child)
      child = parent
      parent = parent.parent
    }
    for (i in levels.indices.reversed()) {
      val (group, branch) = levels[i]
      if (!mapToSelf(group, toSelf)) continue
      val save = canvas.save()
      canvas.concat(toSelf)
      group.background?.draw(canvas)
      val zOrder = group as? ReactZIndexedViewGroup
      val count = group.childCount
      for (k in 0 until count) {
        val index = zOrder?.getZIndexMappedChildIndex(k) ?: k
        val c = group.getChildAt(index) ?: continue
        if (c === branch) break
        if (c.visibility != View.VISIBLE || c.alpha <= 0.01f) continue
        val inner = canvas.save()
        canvas.translate((c.left - group.scrollX).toFloat(), (c.top - group.scrollY).toFloat())
        val m = c.matrix
        if (!m.isIdentity) canvas.concat(m)
        if (c.alpha < 0.999f) {
          canvas.saveLayerAlpha(0f, 0f, c.width.toFloat(), c.height.toFloat(), (c.alpha * 255f).roundToInt())
        }
        // View.draw expects the canvas already offset by the view's own scroll, as the framework's
        // updateDisplayListIfDirty does before calling it. A list's ScrollView depends on it.
        canvas.translate(-c.scrollX.toFloat(), -c.scrollY.toFloat())
        c.draw(canvas)
        canvas.restoreToCount(inner)
      }
      canvas.restoreToCount(save)
    }
    levels.clear()
  }

  /** The matrix taking `ancestor`'s local coordinates to this view's. */
  private fun mapToSelf(ancestor: View, out: Matrix): Boolean {
    walk.reset()
    var v: View = this
    while (v !== ancestor) {
      val p = v.parent as? View ?: return false
      local.set(v.matrix)
      local.postTranslate((v.left - p.scrollX).toFloat(), (v.top - p.scrollY).toFloat())
      walk.postConcat(local)
      v = p
    }
    return walk.invert(out)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || failed) return
    val n = node ?: return
    if (!canvas.isHardwareAccelerated || !n.hasDisplayList()) return
    canvas.drawRenderNode(n)
  }

  companion object {
    val supported: Boolean
      get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    @Volatile
    var lastError: String? = null

    /** Normaliser of glisse's bezel profile: its largest value over the same 256 samples. */
    val BEZEL_MOST: Float by lazy {
      var most = 0.0
      for (i in 0 until 256) {
        val t = max(0.004, i / 255.0)
        val surface = (1.0 - (1.0 - t).pow(4)).pow(0.25)
        val incident = atan((1.0 - t).pow(3) / surface.pow(3))
        val refracted = asin(sin(incident) / 1.5)
        most = max(most, tan(incident - refracted) * (0.6 + surface))
      }
      most.toFloat()
    }

    /**
     * glisse's lens (`lens.ts` puller with `bezel: true`, the BEND and FINISH shaders of `drawn.ts`),
     * evaluated per pixel instead of read from a prerendered field. All lengths in device pixels.
     */
    const val AGSL = """
uniform shader under;
uniform float2 size;
uniform float radius;
uniform float depth;
uniform float reach;
uniform float split;
uniform float frost;
uniform float saturation;
uniform float unit;
uniform float most;

float sdRoundRect(float2 p, float2 hs, float r) {
  float2 q = abs(p) - hs + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float bezelRaw(float t) {
  t = max(0.004, t);
  float a = 1.0 - t;
  float s = pow(1.0 - a * a * a * a, 0.25);
  float inc = atan((a * a * a) / (s * s * s));
  float refr = asin(sin(inc) / 1.5);
  return tan(inc - refr) * (0.6 + s);
}

float4 tap(float2 p) {
  return float4(under.eval(clamp(p, float2(0.5), size - float2(0.5))));
}

float4 soft(float2 p) {
  if (frost < 0.25) {
    return tap(p);
  }
  float o = frost * 0.7;
  return (tap(p) * 2.0 + tap(p + float2(o, o)) + tap(p + float2(-o, o)) + tap(p + float2(o, -o)) + tap(p + float2(-o, -o))) / 6.0;
}

half4 main(float2 coord) {
  float2 hs = size * 0.5;
  float2 x = coord - hs;
  float r = min(radius, min(hs.x, hs.y));
  float edge = sdRoundRect(x, hs, r);
  if (edge >= 0.0 || -edge >= depth) {
    return half4(0.0);
  }
  float rnd = clamp(max(r, depth), 0.0, min(hs.x, hs.y));
  float qx = abs(x.x) - hs.x + rnd;
  float qy = abs(x.y) - hs.y + rnd;
  float2 n = float2(0.0, sign(x.y));
  if (qx > 0.0 && qy > 0.0) {
    n = float2(sign(x.x) * qx, sign(x.y) * qy) / length(float2(qx, qy));
  } else if (qx > qy) {
    n = float2(sign(x.x), 0.0);
  }
  float amount = bezelRaw(-edge / depth) / most;
  float2 d = n * (amount * reach);
  float4 red = soft(coord - d * (1.0 + 0.2 * split));
  float4 green = soft(coord - d * (1.0 + 0.1 * split));
  float4 blue = soft(coord - d);
  float4 c = float4(red.r, green.g, blue.b, (red.a + green.a + blue.a) / 3.0);
  float grey = dot(c.rgb, float3(0.2126, 0.7152, 0.0722));
  c.rgb = clamp(mix(float3(grey), c.rgb, saturation), float3(0.0), float3(c.a));
  float edgePt = -edge / unit;
  float k = min(min(1.0, amount * 20.0), edgePt);
  k = min(k, clamp(edgePt, 0.0, 1.0));
  return half4(c * k);
}
"""
  }
}
