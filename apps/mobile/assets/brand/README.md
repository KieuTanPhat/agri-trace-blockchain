# Mobile branding

Approved concepts, November 5, 2026. Generated with the built-in `image_gen`
tool; selected PNG outputs were copied into this mobile package. Earlier
branding files are preserved. No Web/API assets are changed.

| App | Launcher icon | Logo with text | Canvas |
| --- | --- | --- | --- |
| Staff | [agritrace-staff-icon-v1.png](agritrace-staff-icon-v1.png) | [agritrace-staff-logo-v1.png](agritrace-staff-logo-v1.png) | Icon 1254 × 1254; logo 2172 × 724 |
| Consumer | [acheck-consumer-icon-v1.png](acheck-consumer-icon-v1.png) | [acheck-consumer-logo-v1.png](acheck-consumer-logo-v1.png) | Icon 1254 × 1254; logo 2172 × 724 |

The staff lockup has an alpha background. The consumer lockup has a white
background for its white login screen. Launcher icons use the symbol at small
sizes; the operating system displays the app name below it. Login headers use
the full logo, including the Vietnamese audience label.

`BrandLogo.tsx` contains each lockup in a responsive 3:1 container with a maximum
width and `contentFit="contain"`. The staff home header also allows shrinking
so account/notification controls keep their space. The JS loading view uses the
same logo. The `expo-splash-screen` config plugin uses the variant's square icon
at `imageWidth: 160`, `resizeMode: contain`, on its matching background.

Changing the icon or native launch screen requires a new native build. Reload
is sufficient for the in-app logo/layout when the installed development APK's
other native dependencies match.

## Final prompt set

- Staff symbol: square agricultural employee app icon; forest green background,
  white geometric A with leaf/field-row negative space and a gold completion
  check; strong silhouette and generous safe padding; no slogan or tiny details.
- Consumer symbol: square consumer origin-checking app icon; pale mint background,
  emerald shield, integrated fresh green leaf and a white check; simple flat
  shapes and generous safe padding.
- Staff lockup: preserve the approved A/leaf/field/check icon; compose a horizontal
  3:1 logo, compact rounded icon left, exact text `AgriTrace` right with the
  subtitle `NHÂN VIÊN`; forest green sans-serif, generous padding, transparent
  outer canvas, no extra copy.
- Consumer lockup: use the approved shield/leaf/check as reference; compose a new
  horizontal 3:1 logo on solid white, pale mint rounded icon left, exact text
  `ACheck` right and `NGƯỜI DÙNG` below; clean vector-like edges, correct Vietnamese
  accents, no dots over the English letters, no extra copy or effects.

Only the selected clean outputs above are included. Preview/cleanup variants
are not referenced by the app.
