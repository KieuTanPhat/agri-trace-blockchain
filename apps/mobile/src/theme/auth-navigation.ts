/** Android auth replaces a screen while session/loading subtrees change.
 * Avoid the outgoing native-stack animation retaining views during that commit.
 * This is a scoped workaround, not proof that the native mounting bug is fixed.
 */
export function authScreenAnimation(
  platform: string,
  reducedMotion: boolean,
): "none" | "slide_from_right" {
  return platform === "android" || reducedMotion ? "none" : "slide_from_right";
}
