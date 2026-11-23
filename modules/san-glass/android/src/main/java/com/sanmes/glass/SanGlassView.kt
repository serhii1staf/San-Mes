package com.sanmes.glass

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.graphics.SweepGradient
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.annotation.RequiresApi
import com.facebook.react.uimanager.ReactZIndexedViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.tan

/**
 * What the glass costs, summed over every instance since the last reset, for the perf monitor
 * (`SanGlass.stats()` in JS). Recording happens on the UI thread, reading on the JS thread.
 */
internal object SanGlassStats {
  private var instances = 0
  private var captures = 0
  private var captureNanos = 0L
  private var captureMaxNanos = 0L
  private var levelsRecorded = 0
  private var since = SystemClock.elapsedRealtimeNanos()

  @Synchronized fun attached(delta: Int) {
    instances += delta
  }

  @Synchronized fun captured(nanos: Long) {
    captures += 1
    captureNanos += nanos
    captureMaxNanos = max(captureMaxNanos, nanos)
  }

  @Synchronized fun levelRecorded() {
    levelsRecorded += 1
  }

  @Synchronized fun snapshot(): Map<String, Any> {
    val seconds = max(0.001, (SystemClock.elapsedRealtimeNanos() - since) / 1e9)
    return mapOf(
      "seconds" to seconds,
      "instances" to instances,
      "capturesPerSecond" to captures / seconds,
      "captureMsAverage" to if (captures > 0) captureNanos / 1e6 / captures else 0.0,
      "captureMsMax" to captureMaxNanos / 1e6,
      // UI-thread time spent re-recording what is beneath, per second of wall time.
      "captureMsPerSecond" to captureNanos / 1e6 / seconds,
      // Ancestor levels whose content had to be re-recorded, per capture (the rest were reused).
      "levelsRecordedPerCapture" to if (captures > 0) levelsRecorded.toDouble() / captures else 0.0,
    )
  }

  @Synchronized fun reset() {
    captures = 0
    captureNanos = 0
    captureMaxNanos = 0
    levelsRecorded = 0
    since = SystemClock.elapsedRealtimeNanos()
  }
}

/**
 * San's liquid glass on Android: what is beneath this view, bent at its rim with glisse's lens,
 * optionally frosted, tinted and lit at the rim.
 *
 * Every frame (from the window's pre-draw pass, so only when something on screen actually changes),
 * everything drawn BENEATH this view — at each ancestor level, the parent's background and the children
 * that come before this view's branch in drawing order — is recorded into [node] from those views' own
 * display lists. That is a re-recording of draw commands, not a rasterisation: unchanged children are
 * replayed from their existing RenderNodes. [node] carries an AGSL [RuntimeShader] as its RenderEffect
 * (after a GPU blur when the glass is frosted), so the GPU bends that content when [onDraw] draws the
 * node. Clear glass draws only its rim band and tint; frosted glass draws its whole area.
 */
@SuppressLint("ViewConstructor")
class SanGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** Corner radii in dp: top-left, top-right, bottom-right, bottom-left. */
  var cornerRadiiDp = floatArrayOf(0f, 0f, 0f, 0f)
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
  /** Laid over the glass (ARGB), or 0 for none. */
  var tintColor = 0
    set(value) { field = value; uniformsDirty = true; invalidate() }
  /** glisse's rim light, 0 (none) to 1 (the clear glass's). */
  var shine = 0f
    set(value) { field = value; uniformsDirty = true; invalidate() }
  /** Frosted body: blur of what is beneath, dp (as a Gaussian sigma). 0 leaves the middle to the live content. */
  var blurDp = 0f
    set(value) { field = value; uniformsDirty = true; invalidate() }

  private var uniformsDirty = true
  // Set when this view's own display list must be re-recorded: a new node, or a new effect on it.
  private var needsRedraw = true
  private var node: RenderNode? = null
  private var shader: RuntimeShader? = null
  private var failed = false
  private var recording = false
  private var attachedToStats = false
  private var observer: ViewTreeObserver? = null
  private val visible = Rect()
  private val walk = Matrix()
  private val local = Matrix()

  /**
   * One ancestor level: what is drawn beneath this view inside `group` (its background and the
   * children before `branch`), recorded in the group's own coordinates into `node`. `matrix` places
   * the group relative to this view and is refreshed every frame, so a scroll or a moving ancestor
   * costs nothing more; the content is re-recorded only when `signature` (the geometry the recording
   * bakes in) changes, a leaf in it is dirty, or the refresh is due.
   */
  private class Level {
    var group: ViewGroup? = null
    var branch: View? = null
    val node = RenderNode("SanGlassLevel")
    /** The group's coordinates to this view's, and the reverse. */
    val matrix = Matrix()
    val toGroup = Matrix()
    /** This view's area plus REACH_MARGIN_DP, in the group's coordinates. */
    val reach = RectF()
    var signature = 0L
    var recorded = false
    var framesSinceRecord = 0
  }

  private val levels = ArrayList<Level>(24)
  private var levelCount = 0
  private val siblingRect = RectF()

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
    if (!attachedToStats) {
      attachedToStats = true
      SanGlassStats.attached(1)
    }
  }

  override fun onDetachedFromWindow() {
    observer?.let { if (it.isAlive) it.removeOnPreDrawListener(preDraw) }
    observer = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      node?.discardDisplayList()
      for (level in levels) {
        level.node.discardDisplayList()
        level.recorded = false
        level.group = null
        level.branch = null
      }
    }
    levelCount = 0
    if (attachedToStats) {
      attachedToStats = false
      SanGlassStats.attached(-1)
    }
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    uniformsDirty = true
  }

  /** Transparent through this view or an ancestor: nothing of the glass would be seen. */
  private fun faded(): Boolean {
    var alpha = 1f
    var v: View? = this
    while (v != null) {
      alpha *= v.alpha
      if (alpha < 0.01f) return true
      v = v.parent as? View
    }
    return false
  }

  private fun capture() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || failed || recording) return
    // The lit rim alone is drawn in onDraw from this view's own props: nothing beneath to record.
    if (rimOnly) return
    // Off screen, collapsed, covered by a pushed screen's window, or faded out: nothing to bend, and no
    // reason to re-record anything.
    if (!isShown || width < 2 || height < 2 || !getGlobalVisibleRect(visible) || faded()) return
    recording = true
    val started = SystemClock.elapsedRealtimeNanos()
    try {
      record()
    } catch (t: Throwable) {
      failed = true
      lastError = t.toString()
    } finally {
      recording = false
      SanGlassStats.captured(SystemClock.elapsedRealtimeNanos() - started)
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

  // ── WHAT IS RE-RECORDED, AND WHEN ─────────────────────────────────────────────────────────────
  //
  // The first version re-recorded everything beneath the glass on every frame: at each ancestor level,
  // `View.draw` of every sibling before this view's branch. Measured on the Android emulator (debug
  // build, the own profile flung up and down, eight glass views on screen): 5 to 8 ms of UI thread a
  // frame, and a third of the frames janky against 2 % with the glass off.
  //
  // Most of that work re-records content that did not change. A sibling's recording draws its own
  // content and, for its children, REFERENCES to their RenderNodes, which the RenderThread renders as
  // they are in the frame it draws (the same mechanism that keeps `View.setRenderEffect` live over
  // animating children). A list scrolling under a header only changes where the list's content node
  // sits; an image loading deep inside a card only changes that card's own node. So:
  //
  //   - Each ancestor level is recorded into its own node, in the group's coordinates.
  //   - A level's content is re-recorded only when the geometry it bakes in changes (`signature`:
  //     its siblings' positions, sizes, scroll offsets, transforms, visibility and alpha), when one of
  //     those siblings is itself dirty (its own drawing changed: a new background, a leaf view's
  //     content), or every REFRESH_FRAMES frames as a backstop for changes neither of those catches.
  //   - The root node is re-recorded every frame, but it only draws each level node under the matrix
  //     that places that group relative to this view (scroll offsets, translations, a moving
  //     ancestor): one save, concat, draw and restore per level.
  //
  // The level nodes are recorded with their whole content (no clip): drawing them is a replay of
  // references, and the root node's bounds clip the result to this view.

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
    collectLevels()
    val margin = REACH_MARGIN_DP * resources.displayMetrics.density
    for (i in 0 until levelCount) {
      val level = levels[i]
      val group = level.group ?: continue
      val branch = level.branch ?: continue
      // This view's area, with a margin, in the group's coordinates: siblings that do not reach it
      // cannot show through the glass, so they are neither drawn nor hashed.
      level.reach.set(-margin, -margin, w + margin, h + margin)
      level.toGroup.mapRect(level.reach)
      val signature = signatureOf(level, group, branch)
      level.framesSinceRecord++
      val due = level.framesSinceRecord >= REFRESH_FRAMES
      // `hasDisplayList()`: the render thread drops a node's content when it leaves the drawn tree
      // (this view hidden or covered for a frame), and an empty level must not be reused.
      if (!level.recorded || !level.node.hasDisplayList() || signature != level.signature || due ||
        anySiblingDirty(level, group, branch)
      ) {
        recordLevel(level, group, branch)
        level.signature = signature
        level.framesSinceRecord = 0
        level.recorded = true
        SanGlassStats.levelRecorded()
      }
    }
    // ── A ROOT WITHOUT CONTENT MEANS THIS VIEW MUST BE REDRAWN TOO ───────────────────────────────
    //
    // This view's own display list draws `node` only if `node` had content when `onDraw` ran. The node
    // loses its content when this view is detached (`onDetachedFromWindow` discards it) and when the
    // render thread drops it, which it does to every node that leaves the drawn tree. Logged on the
    // emulator: when a screen comes back (a chat closed over the profile, a tab shown again), every
    // glass on it is drawn once BEFORE its first capture after the re-attach, so its display list is
    // recorded without the node. Refilling the node alone never puts it back, because nothing
    // invalidates this view: the glass kept only what is drawn over it (the tab bar's rim image) and
    // lost its bend, tint and frost until something else redrew it (the app going to the background,
    // a prop change). Brand-new views were spared only because a new node already forces a redraw.
    // So a capture that finds the node empty redraws this view once: one extra frame per re-attach,
    // none in steady state.
    if (!n.hasDisplayList()) needsRedraw = true
    // The root lists the levels, each placed by its matrix. Re-recorded every frame: a handful of
    // operations, against the levels' content, which is what the reuse above saves.
    val canvas = n.beginRecording(w, h)
    try {
      // Outermost level first: what the window draws first is beneath everything else.
      for (i in levelCount - 1 downTo 0) {
        val level = levels[i]
        if (!level.recorded) continue
        val save = canvas.save()
        canvas.concat(level.matrix)
        canvas.drawRenderNode(level.node)
        canvas.restoreToCount(save)
      }
    } finally {
      n.endRecording()
    }
  }

  /**
   * Fills `levels` from this view up to the root, with each group's coordinates-to-this-view matrix,
   * in one walk: `walk` accumulates this view's coordinates to the current group's.
   */
  private fun collectLevels() {
    var count = 0
    var child: View = this
    var parent = child.parent
    walk.reset()
    while (parent is ViewGroup) {
      if (count == levels.size) levels.add(Level())
      val level = levels[count]
      if (level.group !== parent || level.branch !== child) {
        level.group = parent
        level.branch = child
        level.recorded = false
      }
      local.set(child.matrix)
      local.postTranslate((child.left - parent.scrollX).toFloat(), (child.top - parent.scrollY).toFloat())
      walk.postConcat(local)
      level.toGroup.set(walk)
      if (!walk.invert(level.matrix)) level.matrix.reset()
      count++
      child = parent
      parent = parent.parent
    }
    for (i in count until levelCount) {
      levels[i].node.discardDisplayList()
      levels[i].group = null
      levels[i].branch = null
      levels[i].recorded = false
    }
    levelCount = count
  }

  /**
   * Whether sibling `c` of `group` can reach this view's area (`level.reach`, in the group's
   * coordinates). Its own bounds under its transform; a child drawn further out than REACH_MARGIN_DP
   * beyond its parent's box is not seen, the same trade-off the iOS capture makes.
   */
  private fun reaches(level: Level, group: ViewGroup, c: View): Boolean {
    val r = siblingRect
    r.set(0f, 0f, c.width.toFloat(), c.height.toFloat())
    val m = c.matrix
    if (!m.isIdentity) m.mapRect(r)
    r.offset((c.left - group.scrollX).toFloat(), (c.top - group.scrollY).toFloat())
    return RectF.intersects(r, level.reach)
  }

  /** The geometry a level's recording bakes in. Cheap: a few fields per sibling, no drawing. */
  private fun signatureOf(level: Level, group: ViewGroup, branch: View): Long {
    var h = 1469598103934665603L
    fun mix(v: Long) { h = (h xor v) * 1099511628211L }
    fun mixF(v: Float) = mix(java.lang.Float.floatToIntBits(v).toLong())
    mix(System.identityHashCode(group.background).toLong())
    val zOrder = group as? ReactZIndexedViewGroup
    val count = group.childCount
    mix(count.toLong())
    for (k in 0 until count) {
      val index = zOrder?.getZIndexMappedChildIndex(k) ?: k
      val c = group.getChildAt(index) ?: continue
      if (c === branch) break
      if (!reaches(level, group, c)) continue
      mix(System.identityHashCode(c).toLong())
      mix(System.identityHashCode(c.background).toLong())
      mix(c.left.toLong()); mix(c.top.toLong()); mix(c.right.toLong()); mix(c.bottom.toLong())
      mix(c.scrollX.toLong()); mix(c.scrollY.toLong())
      mix(c.visibility.toLong())
      mixF(c.alpha); mixF(c.translationX); mixF(c.translationY)
      mixF(c.scaleX); mixF(c.scaleY); mixF(c.rotation)
    }
    return h
  }

  /**
   * Whether a sibling beneath has changed its own drawing since the level was recorded. A group's own
   * drawing is its background (part of the signature) and its children, which are live references,
   * so only leaves (text, images, drawn views) can have stale own content.
   */
  private fun anySiblingDirty(level: Level, group: ViewGroup, branch: View): Boolean {
    val zOrder = group as? ReactZIndexedViewGroup
    val count = group.childCount
    for (k in 0 until count) {
      val index = zOrder?.getZIndexMappedChildIndex(k) ?: k
      val c = group.getChildAt(index) ?: continue
      if (c === branch) break
      if (c !is ViewGroup && c.isDirty && reaches(level, group, c)) return true
    }
    return false
  }

  /** Records, in `group`'s coordinates, its background and its children before `branch`. */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun recordLevel(level: Level, group: ViewGroup, branch: View) {
    val gw = max(1, group.width)
    val gh = max(1, group.height)
    val ln = level.node
    if (ln.width != gw || ln.height != gh) ln.setPosition(0, 0, gw, gh)
    // Children may be drawn outside the group's bounds (offsets, shadows); the root node clips.
    ln.clipToBounds = false
    val canvas = ln.beginRecording(gw, gh)
    try {
      group.background?.draw(canvas)
      val zOrder = group as? ReactZIndexedViewGroup
      val count = group.childCount
      for (k in 0 until count) {
        val index = zOrder?.getZIndexMappedChildIndex(k) ?: k
        val c = group.getChildAt(index) ?: continue
        if (c === branch) break
        if (c.visibility != View.VISIBLE || c.alpha <= 0.01f || !reaches(level, group, c)) continue
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
    } finally {
      ln.endRecording()
    }
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun applyUniforms(n: RenderNode, w: Int, h: Int) {
    val density = resources.displayMetrics.density
    val shorterDp = min(w, h) / density
    val depthPx = max(1f, min(depthFraction * shorterDp, maxDepthDp) * density)
    val s = shader ?: RuntimeShader(AGSL).also { shader = it }
    val r = cornerRadiiDp
    s.setFloatUniform("size", w.toFloat(), h.toFloat())
    s.setFloatUniform("radii", r[0] * density, r[1] * density, r[2] * density, r[3] * density)
    val a = Color.alpha(tintColor) / 255f
    s.setFloatUniform(
      "tint",
      Color.red(tintColor) / 255f * a,
      Color.green(tintColor) / 255f * a,
      Color.blue(tintColor) / 255f * a,
      a,
    )
    s.setFloatUniform("depth", depthPx)
    s.setFloatUniform("reach", bend * depthPx)
    s.setFloatUniform("split", dispersion)
    s.setFloatUniform("frost", frostDp * density)
    s.setFloatUniform("saturation", saturation)
    s.setFloatUniform("unit", density)
    s.setFloatUniform("most", BEZEL_MOST)
    s.setFloatUniform("shine", shine.coerceIn(0f, 1f))
    s.setFloatUniform("body", if (blurDp > 0f) 1f else 0f)
    val bent = RenderEffect.createRuntimeShaderEffect(s, "under")
    // `blurDp` is a Gaussian sigma, as on iOS (Metal Performance Shaders); Android's blur takes a
    // radius, which it turns into a sigma as radius * 0.57735 + 0.5.
    val radius = max(0f, (blurDp * density - 0.5f) / 0.57735f)
    n.setRenderEffect(
      if (blurDp > 0f && radius >= 1f) {
        RenderEffect.createChainEffect(bent, RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP))
      } else {
        bent
      },
    )
    uniformsDirty = false
  }

  // ── NO BEND, NO BLUR: THE LIT RIM ALONE, AS PLAIN STROKES ──────────────────────────────────────
  //
  // That is how small controls are drawn on Android (SanGlassSurface.tsx, "control"): a fill of their
  // own with glisse's lit rim on top. With nothing bent or blurred the glass needs nothing from beneath,
  // and a runtime shader would still cost an offscreen layer per view every frame: measured on the
  // emulator, a chat scroll with its six controls drawn that way had about 20 more frames over 17 ms
  // in 120 than with flat controls. So the rim is drawn here with the shader's own formula
  // (`rimLight`): brightness pow(min(1, |n.x + n.y|), 1.5) for the edge normal n, so full on the
  // straight sides and on the top-left and bottom-right curves, fading out towards the other two, over
  // a band of 1.22 pt that is brightest at the edge (two strokes, its outer and inner halves). It is
  // recorded once into this view's display list and re-recorded only when a prop or the size changes.
  private val rimOnly: Boolean
    get() = bend <= 0f && blurDp <= 0f

  private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.BUTT
  }
  private val rimFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val rimRect = RectF()
  private val rimPath = Path()

  private fun drawRim(canvas: Canvas) {
    val w = width.toFloat()
    val h = height.toFloat()
    if (w < 2f || h < 2f) return
    val d = resources.displayMetrics.density
    val half = min(w, h) / 2f
    val tl = min(cornerRadiiDp[0] * d, half)
    val tr = min(cornerRadiiDp[1] * d, half)
    val br = min(cornerRadiiDp[2] * d, half)
    val bl = min(cornerRadiiDp[3] * d, half)
    if (Color.alpha(tintColor) > 0) {
      rimPath.reset()
      rimRect.set(0f, 0f, w, h)
      rimPath.addRoundRect(rimRect, floatArrayOf(tl, tl, tr, tr, br, br, bl, bl), Path.Direction.CW)
      rimFill.color = tintColor
      canvas.drawPath(rimPath, rimFill)
    }
    val s = shine.coerceIn(0f, 1f)
    if (s <= 0f) return
    // 1 - along^1.5 averaged over each half of the band: 0.86 for the outer half, 0.36 for the inner.
    val band = RIM_BAND_PT * d
    rimStroke(canvas, w, h, tl, tr, br, bl, band * 0.25f, band * 0.5f, s * 0.86f)
    rimStroke(canvas, w, h, tl, tr, br, bl, band * 0.75f, band * 0.5f, s * 0.36f)
  }

  /** One stroke, `stroke` wide, its centre line `inset` inside the edge, `alpha` where the edge is fully lit. */
  private fun rimStroke(
    canvas: Canvas, w: Float, h: Float, tl: Float, tr: Float, br: Float, bl: Float,
    inset: Float, stroke: Float, alpha: Float,
  ) {
    rimPaint.strokeWidth = stroke
    rimPaint.shader = null
    rimPaint.color = Color.argb((alpha * 255f).roundToInt().coerceIn(0, 255), 255, 255, 255)
    // The straight sides face straight out: |n.x + n.y| = 1, fully lit.
    if (w - tr > tl) canvas.drawLine(tl, inset, w - tr, inset, rimPaint)
    if (h - br > tr) canvas.drawLine(w - inset, tr, w - inset, h - br, rimPaint)
    if (w - br > bl) canvas.drawLine(bl, h - inset, w - br, h - inset, rimPaint)
    if (h - bl > tl) canvas.drawLine(inset, tl, inset, h - bl, rimPaint)
    // The corners, each an arc around its own centre (angles clockwise from 3 o'clock, y down).
    rimArc(canvas, tl, tl, tl, inset, 180f, alpha)
    rimArc(canvas, w - tr, tr, tr, inset, 270f, alpha)
    rimArc(canvas, w - br, h - br, br, inset, 0f, alpha)
    rimArc(canvas, bl, h - bl, bl, inset, 90f, alpha)
  }

  private fun rimArc(canvas: Canvas, cx: Float, cy: Float, radius: Float, inset: Float, start: Float, alpha: Float) {
    val rr = radius - inset
    if (rr <= 0.5f) return
    val colors = IntArray(RIM_LIGHT.size) { i ->
      Color.argb((alpha * RIM_LIGHT[i] * 255f).roundToInt().coerceIn(0, 255), 255, 255, 255)
    }
    rimPaint.shader = SweepGradient(cx, cy, colors, RIM_STOPS)
    rimPaint.color = Color.WHITE
    canvas.drawArc(cx - rr, cy - rr, cx + rr, cy + rr, start, 90f, false, rimPaint)
    rimPaint.shader = null
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || failed) return
    if (rimOnly) {
      drawRim(canvas)
      return
    }
    val n = node ?: return
    if (!canvas.isHardwareAccelerated || !n.hasDisplayList()) return
    canvas.drawRenderNode(n)
  }

  companion object {
    val supported: Boolean
      get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    /**
     * Frames after which a level is re-recorded even if nothing it bakes in looks changed: the backstop
     * for own-drawing changes the signature cannot see (a background colour changed in place).
     */
    const val REFRESH_FRAMES = 30

    /**
     * How far beyond this view's edges a sibling may lie and still be captured, dp: content drawn
     * outside a parent's box (shadows, small offsets) and what the rim's bend and the frost's blur
     * pull in from just outside. Siblings further away are skipped, which keeps a glass from
     * recording (and holding references to) views elsewhere on screen.
     */
    const val REACH_MARGIN_DP = 48f

    /** Width of glisse's lit rim band, pt (the 1.22 of `rimLight` in the shader below). */
    const val RIM_BAND_PT = 1.22f

    /** Where the rim's brightness is sampled around a corner: fractions of a turn, clockwise from 3 o'clock. */
    val RIM_STOPS: FloatArray = FloatArray(25) { it / 24f }

    /** The rim's brightness for an edge whose normal points at each of [RIM_STOPS] (y down). */
    val RIM_LIGHT: FloatArray = FloatArray(25) { i ->
      val a = i / 24.0 * 2.0 * Math.PI
      min(1.0, abs(cos(a) + sin(a))).pow(1.5).toFloat()
    }

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
     * evaluated per pixel instead of read from a prerendered field, plus a tint, a frosted body, glisse's
     * lit rim (`rimMap`) and a radius per corner. Identical to the Metal version in SanGlassShader.swift.
     * All lengths in device pixels.
     */
    const val AGSL = """
uniform shader under;
uniform float2 size;
uniform float4 radii;
uniform float4 tint;
uniform float depth;
uniform float reach;
uniform float split;
uniform float frost;
uniform float saturation;
uniform float unit;
uniform float most;
uniform float shine;
uniform float body;

float cornerAt(float2 p) {
  return p.x < 0.0 ? (p.y < 0.0 ? radii.x : radii.w) : (p.y < 0.0 ? radii.y : radii.z);
}

float sdRoundRect(float2 p, float2 hs, float r) {
  float2 q = abs(p) - hs + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float2 normalAt(float2 x, float2 hs, float rr) {
  float qx = abs(x.x) - hs.x + rr;
  float qy = abs(x.y) - hs.y + rr;
  float2 n = float2(0.0, sign(x.y));
  if (qx > 0.0 && qy > 0.0) {
    n = float2(sign(x.x) * qx, sign(x.y) * qy) / length(float2(qx, qy));
  } else if (qx > qy) {
    n = float2(sign(x.x), 0.0);
  }
  return n;
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

float4 saturated(float4 c) {
  float grey = dot(c.rgb, float3(0.2126, 0.7152, 0.0722));
  c.rgb = clamp(mix(float3(grey), c.rgb, saturation), float3(0.0), float3(c.a));
  return c;
}

float rimLight(float insidePt, float2 n) {
  float facing = abs(n.x + n.y);
  float along = max(0.0, insidePt) / (1.22 * sqrt(max(1.0, facing)));
  if (along >= 1.0) {
    return 0.0;
  }
  return pow(min(1.0, facing), 1.5) * (1.0 - pow(along, 1.5));
}

half4 main(float2 coord) {
  float2 hs = size * 0.5;
  float2 x = coord - hs;
  float r = min(cornerAt(x), min(hs.x, hs.y));
  float edge = sdRoundRect(x, hs, r);
  if (edge >= 0.5) {
    return half4(0.0);
  }
  float cover = clamp(0.5 - edge, 0.0, 1.0);
  float inside = -edge;
  float4 base = float4(0.0);
  if (body > 0.5) {
    base = saturated(tap(coord));
  }
  float4 c = base;
  if (reach > 0.0 && inside < depth) {
    float rnd = clamp(max(r, depth), 0.0, min(hs.x, hs.y));
    float2 n = normalAt(x, hs, rnd);
    float amount = bezelRaw(max(inside, 0.0) / depth) / most;
    float2 d = n * (amount * reach);
    float4 red = soft(coord - d * (1.0 + 0.2 * split));
    float4 green = soft(coord - d * (1.0 + 0.1 * split));
    float4 blue = soft(coord - d);
    float4 bent = saturated(float4(red.r, green.g, blue.b, (red.a + green.a + blue.a) / 3.0));
    float k = min(min(1.0, amount * 20.0), clamp(inside / unit, 0.0, 1.0));
    c = bent * k + base * (1.0 - k);
  }
  c = tint + c * (1.0 - tint.a);
  if (shine > 0.0) {
    float l = shine * rimLight(inside / unit, normalAt(x, hs, r));
    c = float4(l) + c * (1.0 - l);
  }
  return half4(c * cover);
}
"""
  }
}
