/**
 * Zoom, shared by the viewers that have it.
 *
 * A person who has zoomed a PDF here should not have to learn a second set of
 * controls to zoom an image, so the steps, the fit rule and the stepping
 * behaviour live in one place rather than being reimplemented per viewer.
 */

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * The zoom at which something of `natural` width fits into `available`.
 *
 * Never magnifies. Widening a small image to fill a large monitor is not what
 * "fit" means to anyone, and it would change what a desktop user sees for no
 * reason — the point of fitting is to rescue content too wide for its window,
 * which is a phone-shaped problem.
 *
 * Returns 1 until both measurements are known, so nothing renders at a
 * meaningless scale during the frame before the first measurement lands.
 */
export function fitZoom(available: number, natural: number): number {
  if (available <= 0 || natural <= 0) return 1;
  return Math.min(1, available / natural);
}

/**
 * The next step above or below the zoom currently in effect.
 *
 * By value rather than by index, because the starting point is often a fitted
 * zoom that is not one of the steps at all. `null` means there is nothing
 * further in that direction, which is what disables the button.
 */
export function zoomInFrom(zoom: number): number | null {
  return ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? null;
}

export function zoomOutFrom(zoom: number): number | null {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? null;
}
