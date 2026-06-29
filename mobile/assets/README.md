# `assets/` — store + app binary assets (to add before EAS build)

These binary assets aren't committed yet (they're design deliverables). Add them
here and reference them from `app.config.ts` before the first production build.

| Asset | Path | Spec |
|---|---|---|
| App icon | `assets/icon.png` | 1024×1024 PNG, no alpha, no rounded corners (stores mask it) |
| Adaptive icon (Android) | `assets/adaptive-icon.png` | 1024×1024 foreground, safe zone centered |
| Splash | `assets/splash.png` | ~1284×2778, on `--bg` (#07090e) |
| Notification icon (Android) | `assets/notification-icon.png` | 96×96 white-on-transparent |

Then add to `app.config.ts`:

```ts
icon: "./assets/icon.png",
splash: { image: "./assets/splash.png", resizeMode: "contain", backgroundColor: "#07090e" },
android: { adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#07090e" } },
```

## Store listing assets (uploaded in App Store Connect / Play Console, not here)

- Screenshots per device class (the app's own honesty bar applies — show the real product).
- App Store: 6.7"/6.5"/5.5" iPhone + 12.9" iPad sets; promo text, description, keywords.
- Play: phone + 7"/10" tablet; short (80) + full (4000) description, feature graphic 1024×500.
