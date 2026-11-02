Style: Pixel Art, SciFi, Futuristic, top-down (orthogonal) 2D, flat-shaded with clean readable silhouettes — no isometric or perspective angling, matching a clean RimWorld-style simulation look
Generation Format: 1 sheet. An 8x8 grid of 64 uniform square tiles. Each tile must fill its entire cell completely edge-to-edge with NO gap, padding, or border between tiles.
Background: tiles are fully opaque, edge-to-edge — no transparency and no green background needed, since floor/wall tiles are solid.

IMPORTANT — fixing a defect from the previous attempt: the last batch of these tiles each had a visible dark outline/border drawn around their own edges (like an icon or sticker would have). This makes the whole floor/wall look like a grid of separate stickers instead of one continuous seamless surface, which is NOT what we want. For this batch:
- Do NOT draw any outline, border, bevel, drop-shadow, or vignette around the edge of any individual tile.
- Each tile's texture must bleed all the way to the edge of its cell with no darkening or framing at the boundary.
- When two tiles of the same type (e.g. two "clean retail floor" tiles) are placed directly next to each other, there should be NO visible seam, line, or color break at all — it should look like one uninterrupted floor/wall surface, the same way a single large photograph of a floor looks seamless when cut into equal squares.
- Think of each tile as a cropped sample of a continuous material (tile flooring, metal plating, concrete, etc.), not as a self-contained framed icon.
- It is fine for a floor tile to show its own internal grout lines/panel seams (e.g. a 2x2 sub-pattern of floor panels within one tile) as long as that internal pattern lines up and continues naturally into the next tile, rather than the WHOLE tile having a border around its outer edge.

Generation Request:

Modular Floor & Wall Tiles (fill all 64 cells; named below are required, remaining cells can be sensible variations in the same style):
- Floors: clean retail tile floor, scuffed/worn retail floor, polished concrete backroom floor, metal grated industrial floor, exterior loading-pad tarmac/durasteel plating, hazard-striped floor edge, entrance threshold mat, dark carpet (manager's office floor)
- Walls: plain interior wall panel, interior wall panel with support girder, exterior hull wall panel, windowed wall panel (view to stars/space), closed security blast-door wall section, break-room blind door (same wall texture, no visible handle, meant to blend in per design), loading-pad exterior wall with awning opening, inner wall corner piece, outer wall corner piece, wall panel with exposed pipe/conduit run
After Generating, but before Finishing, please revisit the sheet and specifically check for the outline defect described above: zoom into at least 4 adjacent tile pairs and confirm there is no visible border, seam, or darkened edge between them. Confirm every tile aligns exactly to its grid cell with no bleed into neighboring cells. Ensure there are no malformed images.
