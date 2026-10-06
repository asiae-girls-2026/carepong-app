# Filimong Two Base Characters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and approve one 128 × 128 pixel-art neutral base pose for each of Filimong's first two creatures: a quokka-inspired dream spirit and an axolotl-inspired dream spirit.

**Architecture:** Treat each character as a separate approval unit. Explore silhouettes first, approve one silhouette, convert it to a constrained pixel-art base pose, validate it at actual desktop display sizes, and only then repeat for the second character. This plan creates static base poses and source references only; animation frames, growth variants, hybrid offspring, and runtime integration are separate follow-up work.

**Tech Stack:** AI-assisted raster concept generation, Aseprite-compatible PNG assets, 128 × 128 transparent RGBA PNG, existing Electron/React desktop preview

## Global Constraints

- Art direction is a cute dream spirit, not a literal animal reproduction.
- Character A uses quokka cues: round cheeks, smiling mouth, round ears, cloud-like tail.
- Character B uses axolotl cues: wide face, calm expression, star-shaped dream feelers, wave-like tail.
- Both characters share body height, eye baseline, limb anchors, center axis `x = 64 px`, and ground line `y = 112 px`.
- Every delivery frame uses a `128 × 128 px` transparent canvas without antialiasing.
- Each character palette uses no more than 16 visible colors, excluding transparency.
- The silhouette must remain readable in monochrome and at the app's current stage display sizes of 72, 81, 96, and 109 px.
- Do not modify or delete existing `src/renderer/assets/pets` during this plan.
- Do not start animation, growth-stage, hybrid, or application-integration work before both base poses are approved.

---

## File Structure

- `assets/character-source/quokka-dream/reference.md` — approved visual traits, palette, and rejection notes for Character A.
- `assets/character-source/quokka-dream/base-neutral.png` — approved 128 × 128 neutral base pose for Character A.
- `assets/character-source/axolotl-dream/reference.md` — approved visual traits, palette, and rejection notes for Character B.
- `assets/character-source/axolotl-dream/base-neutral.png` — approved 128 × 128 neutral base pose for Character B.
- `src/renderer/assets/pets-v2/_review/quokka-dream-base.png` — app-preview copy of the approved Character A pose.
- `src/renderer/assets/pets-v2/_review/axolotl-dream-base.png` — app-preview copy of the approved Character B pose.
- `src/renderer/BaseCharacterReview.tsx` — temporary review surface showing both assets at actual desktop sizes and in monochrome.
- `src/renderer/baseCharacterReview.test.ts` — checks that the review surface model covers every required size and both creature IDs.

## Task 1: Quokka Dream Spirit Silhouette

**Files:**
- Create: `assets/character-source/quokka-dream/reference.md`

**Interfaces:**
- Consumes: Character A constraints from `docs/superpowers/specs/2026-07-12-filimong-character-asset-rules.md`.
- Produces: One user-approved silhouette description with exact shape and palette constraints for `base-neutral.png`.

- [ ] **Step 1: Generate three monochrome silhouette candidates**

Generate one comparison image containing three front three-quarter-view candidates on a plain background. All candidates must use a large round head, compact pear-shaped body, two short arms, two short legs, round ears, and one cloud-like tail. Vary only these proportions:

1. `Q-A`: head 58% of total height, very small ears, wide cheeks.
2. `Q-B`: head 54% of total height, medium ears, widest body.
3. `Q-C`: head 60% of total height, medium ears, smallest body and longest tail.

Exclude clothing, props, gradients, text, scenery, photorealism, fur rendering, and extra limbs.

- [ ] **Step 2: Collect one explicit user selection**

Ask the user to choose `Q-A`, `Q-B`, or `Q-C`, or to request one concrete proportion change. Do not combine unapproved features from multiple candidates.

- [ ] **Step 3: Record the approved silhouette**

Write `assets/character-source/quokka-dream/reference.md` with this exact structure and replace bracketed values with the approved candidate's measured choices:

```markdown
# Quokka Dream Spirit Reference

- Approved silhouette: [Q-A, Q-B, or Q-C]
- View: front three-quarter
- Head share of total height: [percentage]
- Body: compact pear shape
- Ears: [small or medium] round ears
- Tail: one cloud-like tail
- Face: two dot eyes, small smiling mouth, round cheeks
- Dream motif: crescent highlight
- Palette: cream base, lavender shadow, pale navy accent
- Maximum visible colors: 16
- Exclusions: clothing, props, realistic fur, gradients, extra limbs
```

- [ ] **Step 4: Commit the approved reference**

```bash
git add assets/character-source/quokka-dream/reference.md
git commit -m "docs: approve quokka dream spirit silhouette"
```

## Task 2: Quokka Dream Spirit Pixel Base

**Files:**
- Create: `assets/character-source/quokka-dream/base-neutral.png`
- Create: `src/renderer/assets/pets-v2/_review/quokka-dream-base.png`

**Interfaces:**
- Consumes: Approved proportions and palette from `assets/character-source/quokka-dream/reference.md`.
- Produces: Transparent 128 × 128 RGBA PNG with center axis `x = 64` and ground line `y = 112`.

- [ ] **Step 1: Render the approved design as pixel art**

Create a neutral pose on a 128 × 128 transparent canvas. Place both feet on `y = 112`, center the torso on `x = 64`, keep the topmost opaque pixel at or below `y = 18`, use hard pixel edges, and restrict visible colors to cream, lavender, pale navy, cheek accent, eye/mouth color, and derived shades within a total of 16.

- [ ] **Step 2: Export the source and review copy**

Save identical PNG bytes to:

```text
assets/character-source/quokka-dream/base-neutral.png
src/renderer/assets/pets-v2/_review/quokka-dream-base.png
```

- [ ] **Step 3: Validate image properties**

Run:

```bash
file assets/character-source/quokka-dream/base-neutral.png
```

Expected output contains `PNG image data, 128 x 128` and `RGBA`.

Inspect the image against these pass conditions:

- both feet touch the same ground line;
- no opaque pixel touches a canvas edge;
- the face reads at 72 px;
- the round ears and cloud tail remain distinct in monochrome;
- no semitransparent edge pixels create antialiasing.

- [ ] **Step 4: Ask for base-pose approval**

Show the asset at 72, 81, 96, 109, and 128 px, plus one monochrome silhouette. Proceed only when the user approves the character's attraction, silhouette, and expression.

- [ ] **Step 5: Commit the approved base**

```bash
git add assets/character-source/quokka-dream/base-neutral.png src/renderer/assets/pets-v2/_review/quokka-dream-base.png
git commit -m "art: add quokka dream spirit base pose"
```

## Task 3: Axolotl Dream Spirit Silhouette

**Files:**
- Create: `assets/character-source/axolotl-dream/reference.md`

**Interfaces:**
- Consumes: Character B constraints and the approved Character A body anchors.
- Produces: One user-approved silhouette description compatible with the same animation rig.

- [ ] **Step 1: Generate three monochrome silhouette candidates**

Generate one comparison image containing three front three-quarter-view candidates. All candidates must share Character A's total body height, eye baseline, torso center, limb count, and limb anchors. Use a wide rounded head, compact body, short arms and legs, two symmetrical star-like dream feelers, and one wave-like tail. Vary only these proportions:

1. `A-A`: three-prong feelers, widest head, smallest tail.
2. `A-B`: rounded star feelers, medium head, medium tail.
3. `A-C`: crescent-branched feelers, smallest head, largest wave tail.

Exclude realistic gills, wet skin texture, exposed anatomy, clothing, props, gradients, text, scenery, and extra limbs.

- [ ] **Step 2: Collect one explicit user selection**

Ask the user to choose `A-A`, `A-B`, or `A-C`, or request one concrete proportion change. Check that the choice looks distinct from Character A without appearing to use a different animation skeleton.

- [ ] **Step 3: Record the approved silhouette**

Write `assets/character-source/axolotl-dream/reference.md` with this exact structure:

```markdown
# Axolotl Dream Spirit Reference

- Approved silhouette: [A-A, A-B, or A-C]
- View: front three-quarter
- Body anchors: shared with quokka-dream
- Head: wide rounded shape
- Feelers: [three-prong, rounded star, or crescent-branched]
- Tail: one wave-like tail
- Face: two dot eyes, small calm mouth
- Dream motif: star highlight
- Palette: pale pink base, sky blue shadow, deep violet accent
- Maximum visible colors: 16
- Exclusions: realistic gills, wet texture, exposed anatomy, clothing, props, gradients, extra limbs
```

- [ ] **Step 4: Commit the approved reference**

```bash
git add assets/character-source/axolotl-dream/reference.md
git commit -m "docs: approve axolotl dream spirit silhouette"
```

## Task 4: Axolotl Dream Spirit Pixel Base

**Files:**
- Create: `assets/character-source/axolotl-dream/base-neutral.png`
- Create: `src/renderer/assets/pets-v2/_review/axolotl-dream-base.png`

**Interfaces:**
- Consumes: `assets/character-source/axolotl-dream/reference.md` and Character A's approved anchors.
- Produces: Transparent 128 × 128 RGBA PNG compatible with Character A's animation rig.

- [ ] **Step 1: Render the approved design as pixel art**

Create the neutral pose on a 128 × 128 transparent canvas. Match Character A's feet, torso center, eye baseline, shoulder anchors, and hip anchors. Keep the feelers inside the safe area and use no more than 16 visible colors based on pale pink, sky blue, and deep violet.

- [ ] **Step 2: Export the source and review copy**

Save identical PNG bytes to:

```text
assets/character-source/axolotl-dream/base-neutral.png
src/renderer/assets/pets-v2/_review/axolotl-dream-base.png
```

- [ ] **Step 3: Validate image properties**

Run:

```bash
file assets/character-source/axolotl-dream/base-neutral.png
```

Expected output contains `PNG image data, 128 x 128` and `RGBA`.

Inspect the image against these pass conditions:

- feet, eyes, shoulders, and hips align with the approved quokka base;
- feelers do not touch the canvas edge;
- the face reads at 72 px;
- feelers and wave tail remain distinct in monochrome;
- the character feels cute rather than anatomical or aquatic-realistic.

- [ ] **Step 4: Ask for base-pose approval**

Show both base characters side by side at 72, 81, 96, 109, and 128 px, plus monochrome silhouettes. Proceed only after the user confirms that they feel related but clearly different.

- [ ] **Step 5: Commit the approved base**

```bash
git add assets/character-source/axolotl-dream/base-neutral.png src/renderer/assets/pets-v2/_review/axolotl-dream-base.png
git commit -m "art: add axolotl dream spirit base pose"
```

## Task 5: In-App Size Review Surface

**Files:**
- Create: `src/renderer/BaseCharacterReview.tsx`
- Create: `src/renderer/baseCharacterReview.test.ts`

**Interfaces:**
- Consumes: `/assets/pets-v2/_review/quokka-dream-base.png` and `/assets/pets-v2/_review/axolotl-dream-base.png`.
- Produces: `BaseCharacterReview(): JSX.Element`, a temporary visual QA component.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { reviewEntries } from './BaseCharacterReview'

describe('BaseCharacterReview', () => {
  it('shows both characters at every supported review size', () => {
    for (const id of ['quokka-dream', 'axolotl-dream']) {
      for (const size of [72, 81, 96, 109, 128]) {
        expect(reviewEntries()).toContainEqual({ id, size, silhouette: false })
      }
      expect(reviewEntries()).toContainEqual({ id, size: 128, silhouette: true })
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/renderer/baseCharacterReview.test.ts
```

Expected: FAIL because `./BaseCharacterReview` does not exist.

- [ ] **Step 3: Implement the review component**

```tsx
export const CREATURES = ['quokka-dream', 'axolotl-dream'] as const
export const SIZES = [72, 81, 96, 109, 128] as const

export function reviewEntries() {
  return CREATURES.flatMap((id) => [
    ...SIZES.map((size) => ({ id, size, silhouette: false })),
    { id, size: 128, silhouette: true },
  ])
}

export default function BaseCharacterReview() {
  return (
    <main aria-label="Filimong base character review">
      {CREATURES.map((id) => {
        const src = `/assets/pets-v2/_review/${id}-base.png`
        return (
          <section key={id}>
            <h2>{id}</h2>
            {SIZES.map((size) => (
              <img
                key={size}
                data-testid={`${id}-${size}`}
                src={src}
                alt={`${id} at ${size} pixels`}
                width={size}
                height={size}
                style={{ imageRendering: 'pixelated' }}
              />
            ))}
            <img
              data-testid={`${id}-silhouette`}
              src={src}
              alt={`${id} monochrome silhouette`}
              width={128}
              height={128}
              style={{ imageRendering: 'pixelated', filter: 'brightness(0)' }}
            />
          </section>
        )
      })}
    </main>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/renderer/baseCharacterReview.test.ts
```

Expected: PASS with one test passing.

- [ ] **Step 5: Run the existing test suite**

Run:

```bash
npm test
```

Expected: all existing and new tests pass.

- [ ] **Step 6: Perform final visual review**

Render the review surface and confirm:

- both faces read at 72 px;
- both silhouettes remain distinct at every size;
- feet and eyes align when the characters are side by side;
- neither character clips at 128 px;
- pixel edges remain crisp without browser smoothing.

- [ ] **Step 7: Commit the review surface**

```bash
git add src/renderer/BaseCharacterReview.tsx src/renderer/baseCharacterReview.test.ts
git commit -m "test: add base character visual review surface"
```

## Completion Gate

This plan is complete only when both `base-neutral.png` assets are explicitly approved, the size review passes, and no existing pet asset has been changed or deleted. The next plan may then cover the 22-frame `idle`, `walk`, `eat`, and `pet` validation set for one approved character.
