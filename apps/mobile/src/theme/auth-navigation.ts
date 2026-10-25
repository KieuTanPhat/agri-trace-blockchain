/** Keep auth transitions still on Android while session/keyboard state changes.
 * Web navigation is immediate; iOS transitions respect reduced motion.
 * Device verification is still required for native mounting.
 */
export function authScreenAnimation(
  platform: string,
  reducedMotion: boolean,
): "none" | "slide_from_right" {
  return platform === "android" || platform === "web" || reducedMotion ? "none" : "slide_from_right";
}
