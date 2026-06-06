/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "SanWidget",
  displayName: "San",
  icon: "../../assets/icon.png",
  colors: {
    $accent: "#F09458",
    $widgetBackground: { light: "#FFFFFF", dark: "#141414" },
  },
  frameworks: ["SwiftUI", "WidgetKit"],
  entitlements: {
    // Share the same App Group as the main app so the widget can read feed data.
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
  deploymentTarget: "16.0",
});
