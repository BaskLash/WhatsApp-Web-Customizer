# Spec — add `image_id` to `background_slot_set`

**Status:** Draft, awaiting review. Implementation is a separate change.
**Author:** Claude Code, on behalf of the analytics owner.
**Last updated:** 2026-05-19.

## Goal

Today `background_slot_set` records *which slot* changed (`slot`) and
*which library section* the image came from (`source: "uploaded" |
"predefined"`). It does **not** record *which specific image* was
picked. That blocks the same kind of popularity-based reorder we did
for theme presets and animated backgrounds — we can rank slots and
animations, but the predefined static-image gallery inside each
slot's picker is invisible to the popularity signal.

This spec adds one additive property, `image_id`, that lets us rank
predefined images by adoption. Uploaded images stay opaque to preserve
the PII contract.

## Property shape

Add to `background_slot_set`:

- `image_id` *(string)* — stable enum, one of:
  - A curated predefined slug from `images.json` (kebab-case, see
    [Predefined slugs](#predefined-slugs)).
  - The literal `"uploaded"` for any image from the user's library —
    no matter how it got there (file picker, drag-drop, paste, URL
    import).
  - The literal `"unknown"` for the legacy edge case where a slot
    holds a URL that isn't in `images.json` and isn't in
    `uploadedImages` (see [Edge cases](#edge-cases)).

All values pass the PII contract: fixed enum of extension-internal
identifiers. No URLs, no filenames, no hashes.

## Edge cases

I considered the following non-obvious paths through the code:

1. **URL-imported library images.** The `uploadedImages` array stores
   entries with `source: "upload" | "url"` and an optional
   `originalUrl` (see header comment in `imageSelection.js`). These
   live in the user's library; the picker treats them like any other
   uploaded image. `isUserImage(src)` returns `true` for them, so the
   classifier already routes them to `"uploaded"`. We do **not**
   propagate `originalUrl` into analytics — the user pasted that URL,
   it could be a personal Drive link / private Imgur / signed S3 URL.
   It stays out.

2. **Predefined image still rendered after we remove it from
   `images.json`.** A user's stored slot value could outlive the
   manifest entry that originally seeded it (we ship the URL verbatim
   into `chrome.storage.local[slot]`). After a manifest cleanup,
   `isUserImage(src)` returns `false` (not in `uploadedImages`) and
   the URL also isn't in the current predefined set. Today the
   binary classifier silently labels these `"predefined"` — slightly
   inaccurate, but harmless. With `image_id` we need an honest label.
   Use `"unknown"`. Expected to be < 1% of events; if it ever spikes,
   it's a real signal (probably a stale manifest entry).

3. **Disabled predefined images.** `disabledImages` is a Set of URLs
   the user hid from the manager. They don't appear in the picker, so
   they cannot be the *just-selected* image at the `background_slot_set`
   call site. No analytics implication — the URL→slug lookup still
   resolves them if needed for other events later.

4. **External / pasted URL applied directly to a slot (no library
   step).** Not reachable today. Every path that writes a slot value
   either picks from the predefined gallery or from `uploadedImages`.
   If a future feature ever adds "paste URL → apply to slot directly,
   skip library," `image_id` should be `"unknown"` until that feature
   ships its own analytics decision.

So the value space is exactly: the curated predefined slugs ∪
`{"uploaded", "unknown"}`. Closed enum.

## Where the slug lives

Predefined images today are flat URL strings in
`images.json:predefined.files[]`. **There is no `id` field.** We
need to add one. Proposed shape change:

```json
{
  "predefined": {
    "files": [
      { "id": "wa-landscape", "url": "https://picsum.photos/seed/wa-landscape/1600/900" },
      { "id": "wa-city",      "url": "https://picsum.photos/seed/wa-city/1600/900" },
      ...
    ]
  }
}
```

Migration: parse both shapes for one minor release (string entries
fall back to `image_id: "unknown"`), then drop string support. New
predefined entries must always carry an `id`.

Loader change is local to `imageSelection.js` (where `images.json`
is currently read into `predefinedSrcs`); it builds a
`Map<url, id>` alongside the existing URL list. At the call site
(`imageSelection.js:464` — the `background_slot_set` branch), the
lookup becomes:

```js
const isUploaded = isUserImage(src);
const image_id = isUploaded ? "uploaded" : (urlToId.get(src) || "unknown");
```

No changes to the `source` property — it stays binary as before, for
back-compat with existing dashboards.

## Predefined slugs

Below is the full list of slugs that would start appearing in
PostHog. Review each one for sensitivity before sign-off. None
reference user data; the goal of this section is so you can verify
that yourself.

The 5 `picsum.photos` URLs already encode a meaningful seed in their
path — those become the slug verbatim:

| Slug              | Source URL (host + path) |
|-------------------|--------------------------|
| `wa-landscape`    | `picsum.photos/seed/wa-landscape/...` |
| `wa-city`         | `picsum.photos/seed/wa-city/...` |
| `wa-ocean`        | `picsum.photos/seed/wa-ocean/...` |
| `wa-mountain`     | `picsum.photos/seed/wa-mountain/...` |
| `wa-minimal`      | `picsum.photos/seed/wa-minimal/...` |

The 15 `images.unsplash.com` and 2 `img.freepik.com` URLs use opaque
hash IDs. **These slugs are placeholders — please view each image and
replace with a descriptive kebab-case slug before merging the
implementation change.** I deliberately did not invent topic-style
slugs (`abstract-blue`, `forest`, etc.) without seeing the images,
because a wrong-but-confident slug is worse than a placeholder.

| Placeholder slug   | Source URL (host + photo ID) |
|--------------------|------------------------------|
| `unsplash-01`      | `images.unsplash.com/photo-1523318840068-3e8c0f998509` |
| `unsplash-02`      | `images.unsplash.com/photo-1565881606991-789a8dff9dbb` |
| `unsplash-03`      | `images.unsplash.com/photo-1683134668151-e788d761f5e3` |
| `unsplash-04`      | `images.unsplash.com/photo-1573589684420-6f5d033eb2f7` |
| `unsplash-05`      | `images.unsplash.com/photo-1749649144183-0d26edfa748e` |
| `unsplash-06`      | `images.unsplash.com/photo-1521651201144-634f700b36ef` |
| `unsplash-07`      | `images.unsplash.com/photo-1438565434616-3ef039228b15` |
| `unsplash-08`      | `images.unsplash.com/photo-1535083783855-76ae62b2914e` |
| `unsplash-09`      | `images.unsplash.com/photo-1574068468668-a05a11f871da` |
| `unsplash-10`      | `images.unsplash.com/photo-1589656966895-2f33e7653819` |
| `unsplash-11`      | `images.unsplash.com/photo-1485833077593-4278bba3f11f` |
| `unsplash-12`      | `images.unsplash.com/photo-1493976040374-85c8e12f0c0e` |
| `unsplash-13`      | `images.unsplash.com/photo-1508333706533-1ab43ecb1606` |
| `unsplash-14`      | `images.unsplash.com/photo-1542542540-6da0f4dd4b51` |
| `freepik-01`       | `img.freepik.com/.../mythische-drachenbestie-im-anime-stil` |
| `freepik-02`       | `img.freepik.com/.../vollbild-ninja-mit-ausruestung` |

PII review — none of these slugs reference users, accounts, or
content the user typed. The placeholder slugs are entirely
extension-authored. ✓

## Backwards compatibility

`image_id` is purely additive. Concrete impact:

- **Old extension versions in the wild.** Continue to emit
  `background_slot_set` with `{slot, source[, replaced_animation]}`.
  No `image_id`. PostHog ingests them as-is — properties absent from
  one event are just `null` when grouped. No dual-write needed, no
  rename, nothing for `ANALYTICS.md`'s "Dual-write deprecations"
  table.
- **New extension version, old `images.json`-shape data.** Cannot
  happen at runtime — `images.json` ships in the same build as
  `imageSelection.js`. The dual-shape parser exists only to make the
  manifest review-able in two passes (add the `id` field in one PR,
  delete the string-fallback in a follow-up).
- **PostHog dashboards.** Existing queries that filter on
  `event = background_slot_set` and break down by `source` keep
  working. New queries break down by `image_id` *and* still see
  pre-cutover events bucketed as `image_id = null` — which lets you
  spot the transition cleanly on a timeline chart.

No CHANGELOG entry needed beyond a normal "added per-image
analytics" line.

## PII reasoning — why uploaded stays `"uploaded"`

Three rejected alternatives, for the record:

1. **Filename.** Filenames are user-typed (or filesystem-derived).
   They may contain a person's name (`me-and-anna.jpg`), an account
   slug (`acme-corp-logo.png`), or a leak (`scan-passport.jpg`).
   The PII contract in `ANALYTICS.md:7` is "zero user-entered text."
   Filenames violate that directly. **Rejected.**

2. **Content hash (e.g., SHA-256 of the data URL).** Looks safe — no
   user text — but creates a stable per-image fingerprint that lets
   us correlate a single user's behavior across all events touching
   that image. Two uploaded photos of the same person from the same
   camera have identical EXIF prefixes and may collide; same
   wallpaper used by two users would let us link them. That's a
   behavioral-profile vector with no analytics value we don't
   already get from `image_uploaded` counts. **Rejected.**

3. **`originalUrl` for URL-imported library entries.** The user
   pasted those URLs. They may be private (signed S3, internal CDN,
   personal Drive). User-pasted strings are user-entered text by
   definition. **Rejected.**

The literal `"uploaded"` preserves the `predefined`-vs-`uploaded`
adoption axis — which is the question the event was designed to
answer — and adds no new granularity that requires a privacy
review. The diversity *within* uploaded usage is already partly
measurable from `image_uploaded` (count and method); we can add a
separate event for "uploaded image used N times" later if it ever
becomes a question worth asking.

## PostHog usage after data starts flowing

Two query shapes you'll want:

1. **Rank predefined images by unique adopters.**
   Insight: trend of `background_slot_set` filtered to
   `properties.source = "predefined"`, breakdown by `image_id`,
   aggregation = unique users (`dau` over the analysis window).
   Sort descending → that's the popularity ranking.

2. **Predefined-vs-uploaded ratio per slot.**
   Insight: trend of `background_slot_set`, breakdown by
   `[slot, source]` 2D. Same as today, but you can also drill into
   any single `slot × source = predefined` cell to see which images
   drive that slot's popularity.

A "predefined image popularity" dashboard is one table panel
(insight #1) plus one funnel panel showing
`image_modal_opened` → `background_slot_set` per `image_id` (drop-off
per image lets us spot images that are seen but rarely picked).

## How long before the data is rankable

Rough order-of-magnitude — not statistics, just enough to set
expectations:

- The 4-week slot-reorder window had ~39 unique-user
  `background_slot_set` events total, of which ~22 carried
  `source = "predefined"` (Part 3 of the slot reorder brief). At
  ~5–6 predefined picks per week, splitting across ~20 image_ids
  gives < 0.5 unique users per slug per week — pure noise.
- To match the confidence level of the slot ranking
  (24–28 unique users per item), each predefined image needs
  ~25 users picking it. Worst case (uniform distribution):
  20 × 25 = 500 unique-user picks of predefined images. At the
  current rate that's ~90 weeks. Realistic case (long-tail
  distribution): the top 3–4 images cross the 25-user bar in
  **3–4 months**, the long tail in **6–12 months**.
- A useful first read — "who's an obvious zero-pickup candidate to
  retire" — needs much less: ~6 weeks of data should already show
  which images have *zero* unique users despite a non-trivial
  `image_modal_opened` rate for their slot.

**Recommendation:** Don't promise a reorder timeline. Set a
calendar reminder ~6 weeks post-merge to do the first "retire the
zeros" pass; revisit for a full reorder at ~3 months.

## Implementation surface (informational — separate PR)

For the reviewer's sanity, the change is:

1. `images.json` — flat URL strings → `{id, url}` objects.
2. `imageSelection.js` — parse new manifest shape, build
   `urlToId` map, look it up at the `background_slot_set` call site
   (current line 469).
3. `ANALYTICS.md` — add the `image_id` row to the `background_slot_set`
   property table; document the enum.
4. (Optional, recommended) Backfill the same lookup into
   `image_deleted` and `image_restored` for `kind = "predefined"` —
   same PII reasoning applies. Out of scope for this spec; mention
   in the implementation PR if you want it bundled.

No service-worker change, no manifest version bump.

## Open questions for the reviewer

1. Are the placeholder unsplash/freepik slugs OK as numbered
   placeholders, or do you want me to view each image (via the URLs
   in `images.json`) and propose descriptive slugs before the
   implementation PR? The numbered slugs are stable-enough to ship —
   they're just less self-documenting in PostHog.
2. Should `"unknown"` map to a CHANGELOG note if the rate ever
   crosses some threshold (e.g., > 1% of `background_slot_set`)?
   That's an alerting decision, not a spec decision, but worth
   flagging now.
3. Bundle the `image_deleted` / `image_restored` `image_id`
   addition into the same implementation PR, or keep this PR
   minimal and follow up? I'd lean "follow up" — smaller diff, less
   review surface, and the data value is lower (deletion volume is
   low).
