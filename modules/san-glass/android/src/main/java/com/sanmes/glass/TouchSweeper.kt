package com.sanmes.glass

import android.app.Activity
import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.RootView
import com.facebook.react.uimanager.TouchTargetHelper
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import expo.modules.kotlin.AppContext
import java.lang.ref.WeakReference

/**
 * Works around a React Native 0.81 Android leak: a view that a scroll started on is never deleted.
 *
 * On ACTION_DOWN `JSTouchDispatcher` marks the touched view as having an active touch, so that Fabric
 * defers its deletion until the touch ends. When a ScrollView then takes the gesture over,
 * `onChildStartedNativeGesture` clears the dispatcher's target WITHOUT sweeping that mark, so the
 * deletion is deferred forever: the view, and the subtree still attached to it, stay in
 * `SurfaceMountingManager.mTagToViewState` after it unmounts. Fixed upstream in 0.83
 * (facebook/react-native#52995, 'Ensure active touches are swept before accepting a child native
 * gesture'). Measured here first: after scrolling the long chat six times, 2,612 detached views were
 * held by that map, with 77 tags in `mViewsWithActiveTouches`.
 *
 * This finds the same target the dispatcher marked (same helper, same coordinates) and, after the
 * gesture has been dispatched and has ended, sweeps it with the public `sweepActiveTouchForTag`. If the
 * dispatcher already swept it, that is a no-op. The sweep runs AFTER the event has been delivered, so a
 * view deleted during the touch still receives its touch end first, as the deferral intends.
 */
internal object TouchSweeper {
  // Windows already wrapped. Checked by window, not by the current callback: another SDK may wrap ours
  // in turn (Sentry wraps window callbacks), and re-wrapping on every return to the foreground would
  // stack wrappers for the life of the activity.
  private val installed = java.util.WeakHashMap<Window, Boolean>()

  fun install(activity: Activity?, appContext: AppContext) {
    val host = activity ?: return
    host.runOnUiThread {
      try {
        val window = host.window ?: return@runOnUiThread
        if (installed[window] == true) return@runOnUiThread
        val current = window.callback ?: return@runOnUiThread
        window.callback = SweepingCallback(current, window, appContext)
        installed[window] = true
      } catch (_: Throwable) {
        // A window that cannot be wrapped keeps the leak; it must never cost the app.
      }
    }
  }
}

internal class SweepingCallback(
  private val delegate: Window.Callback,
  private val window: Window,
  private val appContext: AppContext,
) : Window.Callback by delegate {
  private var tag = -1
  private var surfaceId = -1
  private val coords = FloatArray(2)
  private val location = IntArray(2)
  private var root: WeakReference<ViewGroup>? = null

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) remember(event)
    val handled = delegate.dispatchTouchEvent(event)
    val action = event.actionMasked
    if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) sweep()
    return handled
  }

  // Java default methods are not forwarded by Kotlin delegation; forward them explicitly.
  override fun onPointerCaptureChanged(hasCapture: Boolean) {
    delegate.onPointerCaptureChanged(hasCapture)
  }

  override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>?, menu: Menu?, deviceId: Int) {
    delegate.onProvideKeyboardShortcuts(data, menu, deviceId)
  }

  private fun remember(event: MotionEvent) {
    tag = -1
    try {
      val reactRoot = reactRoot() ?: return
      reactRoot.getLocationInWindow(location)
      tag = TouchTargetHelper.findTargetTagAndCoordinatesForTouch(
        event.x - location[0],
        event.y - location[1],
        reactRoot,
        coords,
        null,
      )
      surfaceId = UIManagerHelper.getSurfaceId(reactRoot)
    } catch (_: Throwable) {
      tag = -1
    }
  }

  private fun sweep() {
    val target = tag
    tag = -1
    if (target == -1 || surfaceId == -1) return
    try {
      val context = appContext.reactContext as? ReactContext ?: return
      UIManagerHelper.getUIManager(context, UIManagerType.FABRIC)?.sweepActiveTouchForTag(surfaceId, target)
    } catch (_: Throwable) {
      // Never let the workaround break touch handling.
    }
  }

  private fun reactRoot(): ViewGroup? {
    root?.get()?.let { if (it.isAttachedToWindow) return it }
    val found = find(window.decorView)
    root = found?.let { WeakReference(it) }
    return found
  }

  private fun find(view: View): ViewGroup? {
    if (view is RootView && view is ViewGroup) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val hit = find(view.getChildAt(i))
        if (hit != null) return hit
      }
    }
    return null
  }
}
