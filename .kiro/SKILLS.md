# Installed agent skills (local, gitignored)

These live under `.kiro/skills/` so Kiro loads them automatically at session start.
They are **gitignored** on purpose — one is unlicensed, and several megabytes of
reference docs should not ship in a public app repo. This file is the committed
record of what is installed and how to restore it.

| Skill folder | Source | License | Why it is here |
|---|---|---|---|
| `expo-overview` | github.com/expo/skills | MIT | Entry router for Expo/EAS tasks |
| `expo-native-ui` | github.com/expo/skills | MIT | Apple-HIG-grade native screens, semantic colours, SF Symbols, visual effects |
| `expo-design-system` | github.com/expo/skills | MIT | Design tokens + component variant/size/state conventions (consistency) |
| `expo-animation` | github.com/expo/skills | MIT | Motion decisions: thread, spring vs timing, gesture handoff |
| `expo-router` | github.com/expo/skills | MIT | Navigation, native Stack, headers, modals |
| `eas-app-stores` | github.com/expo/skills | MIT | TestFlight / App Store / Play submission, versions, signing |
| `react-native-best-practices` | github.com/callstackincubator/agent-skills | MIT | FPS / TTI / re-render / FlashList performance (the lag work) |
| `apple-design` | github.com/dickwu/apple-design-skill | none stated | 123 HIG pages + a design-craft lens so screens don't look templated |

## Reinstall (any machine)

Download each repo, copy the listed folders into `.kiro/skills/<name>/` so that
`<name>` matches the `name:` in that skill's `SKILL.md`, then start a new Kiro
session. No build step; they are plain Markdown (+ a couple of helper scripts that
are not executed by default).

## Note on `apple-design`

No SPDX license is declared upstream. It is installed for local agent use only and
is not redistributed (hence the gitignore). Its content is Apple's Human Interface
Guidelines pulled from developer.apple.com; treat it as reference, not as shippable
asset material.
