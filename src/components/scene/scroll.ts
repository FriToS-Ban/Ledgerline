/**
 * Shared, mutable scroll/pointer state read inside useFrame. Kept outside React so scrolling
 * never triggers a re-render; the listeners are attached once by the scene canvas.
 */
export const scrollState = { y: 0, px: 0, py: 0 };

export function trackScrollAndPointer(): () => void {
  const onScroll = () => {
    scrollState.y = window.scrollY;
  };
  const onPointer = (e: PointerEvent) => {
    scrollState.px = (e.clientX / window.innerWidth) * 2 - 1;
    scrollState.py = (e.clientY / window.innerHeight) * 2 - 1;
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pointermove", onPointer, { passive: true });
  return () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pointermove", onPointer);
  };
}
