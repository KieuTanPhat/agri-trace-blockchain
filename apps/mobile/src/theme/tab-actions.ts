/** Always emit tabPress (selected tabs may scroll to top), but never navigate
 * twice or bypass a listener that deliberately prevents the tab change. */
export function activateConsumerTab(
  selected: boolean,
  emit: () => { defaultPrevented: boolean },
  navigate: () => void,
) {
  const event = emit();
  if (selected || event.defaultPrevented) return false;
  navigate();
  return true;
}
export const tabAnimation = (reducedMotion: boolean): "none" | "fade" =>
  reducedMotion ? "none" : "fade";
