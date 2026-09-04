# The cloth layer: where it stands

For whoever picks this up. You know the app; this is what the Cloth globe layer
does today, why Equal Earth still looks like broken glass, and what to try next.
Everything below is committed on `main` and deployed.

## What it does

`src/lib/cloth.js` relaxes a map's sheet onto the sphere instead of computing a
fold pattern from a law the way `relief.js` does. Every mesh edge — sides and
both diagonals — holds the length it has on the flat map, adhesion pulls the
sheet toward radius 1, a Laplacian on the offset from the sphere resists sharp
turns, and the seam and poles are stitched after each pass. `App.jsx` runs it
six passes per animation frame to a budget of 200, so the drape forms on screen
and then holds.

Three things the model needs that are not obvious until it is running:

- **Diagonals, not just sides.** A quad lattice shears for free, and an
  anisotropic sheet takes that path instead of folding.
- **Compression held about seven times harder than stretch** (`STRETCH_GIVE`).
  Too much material folds; too little has to stretch, and holding both at full
  strength leaves the sheet no shape that satisfies either.
- **Its own coarser mesh** (96 columns, `CLOTH_COLUMNS`). The fold scale is
  measured in cells, so a finer lattice buys finer folds, not a better answer.

## What is wrong

**Equal Earth reads as shattered glass; Mercator reads as cloth.** Mercator is
conformal, so its sheet is uniformly too long and the excess has one obvious
outlet. Equal Earth is equal-area: `a·b = 1` makes it too long along one axis
and too short along the perpendicular one at every point. The solver has no idea
which axis is which — it only knows edge lengths — so it answers with noise
where the analytic wrinkle layer, which reads the Tissot major axis, gets a
clean ruffle.

**The relaxation does not converge.** Adhesion and the edge lengths cannot both
be satisfied on such a sheet, so past the point where the folds have formed the
solver cycles between answers. Running it to a budget and freezing is a
presentation fix, not a solution. Annealing the corrections was tried and is
worse: the sheet slumps back toward the sphere and mean edge error climbs from
9% to 26%.

## What to try next, in order

1. **Fuse the two wrinkle models.** Seed the relaxation with `wrinkleRadii`'s
   displacement instead of random noise. The analytic model knows the fold
   direction from the Tissot major axis, which is exactly what the solver
   lacks; the relaxation would then refine a fold pattern that starts at the
   right wavelength rather than discovering one from static. This is the most
   likely fix for Equal Earth and should also cut the pass budget hard.
2. **Show a wedge at high resolution** instead of two whole globes. Every
   projection in the catalog is symmetric about its central meridian and the
   equator — `node scripts/audit.mjs symmetry` measures 0.0000pp mismatch — so a
   quarter carries the whole story, and the same frame budget buys four times
   the mesh. A cutaway also shows the sheet standing off the globe, which the
   outside view hides.
3. **Solve a sliver and replicate it.** Cylindrical projections vary only with
   latitude, so one column of the mesh determines all of it. Cheap, but it makes
   the folds exactly periodic, which is the regularity the cloth layer exists to
   escape. Worth it for `globeField`, probably not for the drape.

## How to check a change

`npm test` covers the solver: edge error must fall by 4x while settling, the
sheet must not sink into the globe, the excess must gather at the poles, the
drape must be deterministic, and the antimeridian must stay stitched. The
scratch scripts that produced the tuning numbers are gone; `scripts/audit.mjs`
keeps the two measurements worth rerunning.
