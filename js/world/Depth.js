// =============================================================================
// FILE: Depth.js
// =============================================================================
// Draw-order layers shared by people and floor crates.
// =============================================================================

// People sort by feet position above this; the tallest map (about 6,800 pixels) stays below
// the 9,000+ layer used for speech bubbles, prompts, and gauges.
export const PEOPLE_DEPTH_BASE = 2000;
