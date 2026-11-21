import Foundation

// MARK: - Shader

/// glisse's lens (`lens.ts` puller with `bezel: true`, the BEND and FINISH shaders of `drawn.ts`),
/// evaluated per pixel, plus what turns it from a lens into a surface: a tint laid over it (the
/// "slightly darkened" glass), a frosted body (the capture blurred, for panels with text on them),
/// glisse's lit rim (`rimMap`, analytically, for any size and shape) and a radius per corner. Kept
/// identical to the AGSL version in SanGlassView.kt. Compiled at run time, so a shader problem
/// disables the glass instead of failing the build.
///
/// Without a tint, a rim light or a body it draws exactly what the first version drew: the bent rim
/// band only, the middle left to the live content.
///
/// Shared with the macOS probe (scripts/ca-probe.swift), which renders it to images to check it.
let sanGlassShaderSource = """
#include <metal_stdlib>
using namespace metal;

struct SanGlassOut {
  float4 position [[position]];
  float2 uv;
};

vertex SanGlassOut san_glass_vertex(uint vid [[vertex_id]]) {
  float2 corner = float2(vid == 1 ? 3.0 : -1.0, vid == 2 ? 3.0 : -1.0);
  SanGlassOut o;
  o.position = float4(corner, 0.0, 1.0);
  o.uv = float2((corner.x + 1.0) * 0.5, (1.0 - corner.y) * 0.5);
  return o;
}

struct SanGlassUniforms {
  float4 radii;
  float4 tint;
  float2 size;
  float depth;
  float reach;
  float split;
  float frost;
  float saturation;
  float unit;
  float most;
  float shine;
  float body;
};

static float san_corner(float2 p, float4 radii) {
  return p.x < 0.0 ? (p.y < 0.0 ? radii.x : radii.w) : (p.y < 0.0 ? radii.y : radii.z);
}

static float san_sd_round_rect(float2 p, float2 hs, float r) {
  float2 q = abs(p) - hs + float2(r);
  return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

static float2 san_normal(float2 x, float2 hs, float rr) {
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

static float san_bezel_raw(float t) {
  t = max(0.004, t);
  float a = 1.0 - t;
  float s = pow(1.0 - a * a * a * a, 0.25);
  float inc = atan((a * a * a) / (s * s * s));
  float refr = asin(sin(inc) / 1.5);
  return tan(inc - refr) * (0.6 + s);
}

static float4 san_tap(texture2d<float> tex, sampler smp, float2 p, float2 size) {
  float2 q = clamp(p, float2(0.5), size - float2(0.5));
  return tex.sample(smp, q / size);
}

static float4 san_soft(texture2d<float> tex, sampler smp, float2 p, float2 size, float frost) {
  if (frost < 0.25) {
    return san_tap(tex, smp, p, size);
  }
  float o = frost * 0.7;
  return (san_tap(tex, smp, p, size) * 2.0
    + san_tap(tex, smp, p + float2(o, o), size)
    + san_tap(tex, smp, p + float2(-o, o), size)
    + san_tap(tex, smp, p + float2(o, -o), size)
    + san_tap(tex, smp, p + float2(-o, -o), size)) / 6.0;
}

static float4 san_saturate(float4 c, float s) {
  float grey = dot(c.rgb, float3(0.2126, 0.7152, 0.0722));
  c.rgb = clamp(mix(float3(grey), c.rgb, float3(s)), float3(0.0), float3(c.a));
  return c;
}

// glisse `rimMap`: light in a band about 1.22 pt inside the edge, full where the edge faces the light's
// diagonal (the straight sides, the top-left and bottom-right curves), fading out towards the other two.
static float san_rim_light(float insidePt, float2 n) {
  float facing = abs(n.x + n.y);
  float along = max(0.0, insidePt) / (1.22 * sqrt(max(1.0, facing)));
  if (along >= 1.0) {
    return 0.0;
  }
  return pow(min(1.0, facing), 1.5) * (1.0 - pow(along, 1.5));
}

fragment float4 san_glass_fragment(SanGlassOut in [[stage_in]],
                                   texture2d<float> under [[texture(0)]],
                                   constant SanGlassUniforms& u [[buffer(0)]]) {
  constexpr sampler smp(coord::normalized, address::clamp_to_edge, filter::linear);
  float2 coord = in.uv * u.size;
  float2 hs = u.size * 0.5;
  float2 x = coord - hs;
  float r = min(san_corner(x, u.radii), min(hs.x, hs.y));
  float edge = san_sd_round_rect(x, hs, r);
  if (edge >= 0.5) {
    return float4(0.0);
  }
  float cover = clamp(0.5 - edge, 0.0, 1.0);
  float inside = -edge;

  // What the glass shows before the rim bends anything: nothing of its own (the live content shows
  // through), or the frosted capture.
  float4 base = float4(0.0);
  if (u.body > 0.5) {
    base = san_saturate(san_tap(under, smp, coord, u.size), u.saturation);
  }
  float4 c = base;
  if (u.reach > 0.0 && inside < u.depth) {
    float rnd = clamp(max(r, u.depth), 0.0, min(hs.x, hs.y));
    float2 n = san_normal(x, hs, rnd);
    float amount = san_bezel_raw(max(inside, 0.0) / u.depth) / u.most;
    float2 d = n * (amount * u.reach);
    float4 red = san_soft(under, smp, coord - d * (1.0 + 0.2 * u.split), u.size, u.frost);
    float4 green = san_soft(under, smp, coord - d * (1.0 + 0.1 * u.split), u.size, u.frost);
    float4 blue = san_soft(under, smp, coord - d, u.size, u.frost);
    float4 bent = san_saturate(float4(red.r, green.g, blue.b, (red.a + green.a + blue.a) / 3.0), u.saturation);
    float k = min(min(1.0, amount * 20.0), clamp(inside / u.unit, 0.0, 1.0));
    c = bent * k + base * (1.0 - k);
  }
  c = u.tint + c * (1.0 - u.tint.a);
  if (u.shine > 0.0) {
    float l = u.shine * san_rim_light(inside / u.unit, san_normal(x, hs, r));
    c = float4(l) + c * (1.0 - l);
  }
  return c * cover;
}
"""

/// Same layout as `SanGlassUniforms` in the shader: two float4, a float2, then nine floats (80 bytes
/// with the float4 alignment).
struct SanGlassUniforms {
  var radii: SIMD4<Float>
  var tint: SIMD4<Float>
  var size: SIMD2<Float>
  var depth: Float
  var reach: Float
  var split: Float
  var frost: Float
  var saturation: Float
  var unit: Float
  var most: Float
  var shine: Float
  var body: Float
}

/// What one glass looks like, in points, independent of where it is drawn.
struct SanGlassLook {
  /// Corner radii, pt: top-left, top-right, bottom-right, bottom-left.
  var radii = SIMD4<Float>(repeating: 0)
  var bend: Float = 1
  var dispersion: Float = 2
  var frost: Float = 0.5
  var saturation: Float = 1.5
  var depthFraction: Float = 0.3
  var maxDepth: Float = 36
  /// Laid over the glass, straight (not premultiplied) RGBA 0...1.
  var tint = SIMD4<Float>(repeating: 0)
  /// glisse's rim light, 0 (none) to 1 (the clear glass's).
  var shine: Float = 0
  /// Frosted body: blur radius of the capture, pt. 0 leaves the middle to the live content.
  var blur: Float = 0

  /// The uniforms for a drawable of `size` pixels at `scale` pixels per point.
  func uniforms(size: SIMD2<Float>, scale: Float, most: Float) -> SanGlassUniforms {
    let widthPt = size.x / scale
    let heightPt = size.y / scale
    let depthPt = min(depthFraction * min(widthPt, heightPt), maxDepth)
    let depthPx = max(1, depthPt * scale)
    let a = max(0, min(1, tint.w))
    return SanGlassUniforms(
      radii: radii * scale,
      tint: SIMD4<Float>(tint.x * a, tint.y * a, tint.z * a, a),
      size: size,
      depth: depthPx,
      reach: bend * depthPx,
      split: dispersion,
      frost: frost * scale,
      saturation: saturation,
      unit: scale,
      most: most,
      shine: max(0, min(1, shine)),
      body: blur > 0 ? 1 : 0
    )
  }
}

enum SanGlassBezel {
  /// Normaliser of glisse's bezel profile: its largest value over the same 256 samples glisse takes.
  static let most: Float = {
    var most = 0.0
    for i in 0..<256 {
      let t = max(0.004, Double(i) / 255.0)
      let surface = pow(1.0 - pow(1.0 - t, 4.0), 0.25)
      let incident = atan(pow(1.0 - t, 3.0) / pow(surface, 3.0))
      let refracted = asin(sin(incident) / 1.5)
      most = max(most, tan(incident - refracted) * (0.6 + surface))
    }
    return Float(most)
  }()
}
