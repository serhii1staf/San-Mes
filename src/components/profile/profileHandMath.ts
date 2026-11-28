/**
 * The geometry and the timeline of the hand that pulls a profile's header up as it scrolls
 * (ProfileHand.tsx). Pure numbers, no React Native, so the choreography reads in one place.
 *
 * ── THE IDEA ────────────────────────────────────────────────────────────────────────────────────
 *
 * A hand grows out of the top of the screen (the Dynamic Island on an iPhone that has one, the top
 * edge elsewhere) as the page starts to scroll. It reaches the avatar, holds it and pulls it up; lets
 * go, swings to the name and pulls that up; then to the row of buttons. At every moment it holds one
 * thing or travels to the next, so the claw is always `shoulder + (target - shoulder) * weight`, with
 * one weight per thing and at most one of them non-zero at a time.
 *
 * Everything is a function of the scroll offset alone, so it is sampled here once and handed to
 * `Animated.Value.interpolate`, which the native driver runs: no JavaScript per frame.
 */

export interface AvatarGeometry {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  travel: number;
  pin: number;
}

/**
 * Where the avatar starts and where it travels to as the page scrolls (the same numbers its own
 * animation in ProfileLayout uses). On an iPhone with an island it docks into it; elsewhere it leaves
 * through the top of the screen.
 */
export function avatarGeometry(topInset: number, width: number, island: boolean): AvatarGeometry {
  const startX = 20 + 42;
  const startY = topInset + 52 + 42;
  const targetX = island ? width / 2 : startX;
  const targetY = island ? topInset / 2 : -70;
  const travel = Math.max(60, startY - targetY);
  const pin = targetY - startY + travel;
  return { startX, startY, targetX, targetY, travel, pin };
}

/** The avatar's centre on screen at scroll offset `s` (the page's own scroll included). */
export function avatarCenterAt(g: AvatarGeometry, s: number): { x: number; y: number } {
  const k = Math.min(1, s / g.travel);
  const translateY = s <= g.travel ? (g.pin * s) / g.travel : g.pin + (s - g.travel);
  return { x: g.startX + (g.targetX - g.startX) * k, y: g.startY - s + translateY };
}

/** Where the name and the buttons sit on the page at scroll 0 (centre y, and where to take hold in x). */
export interface HandMarks {
  nameX: number;
  nameY: number;
  actionsX: number;
  actionsY: number;
}

export function createHandMarks() {
  let part: Partial<HandMarks> = {};
  let value: HandMarks | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: Partial<HandMarks>) {
      let moved = false;
      for (const k of Object.keys(next) as (keyof HandMarks)[]) {
        const was = part[k];
        if (was === undefined || Math.abs(was - (next[k] as number)) > 0.5) moved = true;
      }
      const merged = { ...part, ...next };
      part = merged;
      if (!moved) return;
      const { nameX, nameY, actionsX, actionsY } = merged;
      if ([nameX, nameY, actionsX, actionsY].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        value = { nameX: nameX!, nameY: nameY!, actionsX: actionsX!, actionsY: actionsY! };
        listeners.forEach((l) => l());
      }
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
export type HandMarksStore = ReturnType<typeof createHandMarks>;

export interface HandSamples {
  /** Scroll offsets, strictly increasing. */
  s: number[];
  /** The claw's centre. */
  x: number[];
  y: number[];
  /** Radians to rotate the arm by (clockwise, 0 = straight down). */
  angle: number[];
  /** Arm length in points. */
  len: number[];
  shoulder: { x: number; y: number };
  /** Past this offset the hand is gone. */
  end: number;
}

const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** 0 before `a`, up to 1 at `b`, held to `c`, back to 0 at `d`. */
function bump(s: number, a: number, b: number, c: number, d: number): number {
  if (s <= a || s >= d) return 0;
  if (s < b) return smooth((s - a) / (b - a));
  if (s <= c) return 1;
  return 1 - smooth((s - c) / (d - c));
}

const STEP = 3;
/** How long the claw takes to reach a thing, in points of scroll. */
const REACH = 26;
/** How long it takes to let go and draw back, in points of scroll. */
const RELEASE = 28;
/** A thing is let go of once it has been pulled this close to the shoulder. */
const LET_GO_AT = 14;

export function buildHand(opts: { width: number; topInset: number; island: boolean; marks: HandMarks }): HandSamples {
  const { width, topInset, island, marks } = opts;
  const shoulder = { x: width / 2, y: island ? topInset / 2 : -6 };
  const geo = avatarGeometry(topInset, width, island);

  type Target = { at: (s: number) => { x: number; y: number }; a: number; b: number; c: number; d: number };
  const lines = (x0: number, y0: number) => (s: number) => ({ x: x0, y: y0 - s });
  const sources = [
    (s: number) => avatarCenterAt(geo, s),
    lines(marks.nameX, marks.nameY),
    lines(marks.actionsX, marks.actionsY),
  ];

  const targets: Target[] = [];
  let free = 0;
  for (let i = 0; i < sources.length; i++) {
    const at = sources[i];
    const a = free;
    const b = a + REACH;
    // The first offset, past the grab, at which the thing has been pulled up to the shoulder.
    let c = b + 8;
    while (c < 2000 && at(c).y > shoulder.y + LET_GO_AT) c += STEP;
    const d = c + RELEASE;
    targets.push({ at, a, b, c, d });
    free = d;
  }
  const end = free + 6;

  const out: HandSamples = { s: [], x: [], y: [], angle: [], len: [], shoulder, end };
  for (let s = 0; s <= end + 0.001; s += STEP) {
    let cx = shoulder.x;
    let cy = shoulder.y;
    for (const t of targets) {
      const w = bump(s, t.a, t.b, t.c, t.d);
      if (w <= 0) continue;
      const p = t.at(s);
      cx += (p.x - shoulder.x) * w;
      cy += (p.y - shoulder.y) * w;
    }
    const dx = cx - shoulder.x;
    const dy = cy - shoulder.y;
    out.s.push(s);
    out.x.push(cx);
    out.y.push(cy);
    // A thing above the shoulder only happens while the arm is drawing back to nothing; keep the angle
    // continuous there instead of flipping it over the top.
    out.angle.push(-Math.atan2(dx, Math.max(dy, 1)));
    out.len.push(Math.sqrt(dx * dx + dy * dy));
  }
  return out;
}
