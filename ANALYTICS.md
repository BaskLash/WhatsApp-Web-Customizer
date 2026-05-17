# Analytics — Event Taxonomy

Single source of truth for every PostHog event this extension emits.

- **Transport.** `window.track(eventName, properties)` in `track.js` forwards every event to the service worker (`analytics.js`), which batches and flushes every 30 seconds.
- **Identity.** A random UUID generated on first install (`analytics_distinct_id` in `chrome.storage.local`). No email, phone, or WhatsApp identity.
- **Privacy contract.** Property values are fixed enums, counts, durations, or extension-internal IDs (preset IDs, animation registry IDs, checkbox names from `popup.html`). **Zero user-entered text** — never theme names, never quick-reply text, never message/chat content, never file paths beyond extensions, never URLs. The contract is enforced by callers; the privacy policy and the options page disclose its existence.
- **Theme IDs** pass through `WA_SAFE_THEME_ID_FOR_ANALYTICS()` (in `themes-presets.js`), which collapses legacy name-slugged custom IDs to the literal `"custom-legacy"`. Preset and new-format custom IDs pass through unchanged.

## Conventions

- Event names: `snake_case`, past tense for completed actions.
- Property names: `snake_case`.
- **`source`** is the canonical property for "where in the UI did the user come from."
- **`from_page`** is reserved for the specific case where `source` is already taken for a different axis. Today this applies only to `theme_applied`, where `source` discriminates `"preset"` vs `"custom"` (the theme *type*) and `from_page` carries the entry surface (`"manage"`). This is a documented exception, not an accident — when reusing `source` would cause a semantic collision, use `from_page`.
- Failure events carry a stable `reason` or `error_code` enum, never free-text English.
- Property `version` collisions: see `extension_updated` below; version-transition events use `previous_version`/`version`, never `from`/`to`.

## Dual-write deprecations (active)

Three events currently emit BOTH a legacy property and its replacement. **Both names hold the same value.** After two minor releases past 1.1.4 (so, dropped no earlier than 1.1.6), the legacy property names will be removed. Dashboards must be migrated by then.

| Event | Legacy (to be dropped) | Canonical (new) | Why |
|---|---|---|---|
| `extension_updated` | `from`, `to` | `previous_version`, `version` | `from`/`to` means navigation moves elsewhere — version transitions deserve unambiguous names. |
| `image_deleted` | `from_page` | `source` | Canonical entry-point name; `source` doesn't collide here. |
| `backgrounds_subtab_changed` | `from`, `to` | `from_subtab`, `to_subtab` | Matches `themes_subtab_changed` and `theme_manager_subtab_changed` for cross-event funnel queries. |
| `analytics_flush_failed` | `status` (free-text error message slice) | `error_class` (enum), `endpoint_status` (HTTP code or null) | Stable enum unlocks aggregations. The old `status` carried a 64-char slice of the JS Error message — now duplicates `error_class`. |

After cutover, consumers should query the canonical name only. The PR that removes the legacy properties must include a CHANGELOG note.

---

## Events

### Lifecycle / system

#### `extension_installed`
- **Q:** When are users installing this extension? (Cohort analysis denominator.)
- **Trigger:** Chrome fires `onInstalled` with `reason: "install"`.
- **Properties:**
  - `version` *(string)* — current manifest version.

#### `extension_updated`
- **Q:** What's the version-upgrade funnel? Are users stuck on old versions?
- **Trigger:** Chrome `onInstalled` with `reason: "update"` and a different `previousVersion`.
- **Properties:**
  - `previous_version` *(string)* — version before the update.
  - `version` *(string)* — current version after the update.
  - `from` *(string)* — **DEPRECATED**, mirrors `previous_version`.
  - `to` *(string)* — **DEPRECATED**, mirrors `version`.

#### `whatsapp_web_loaded`
- **Q:** Which extension features are active on a real WhatsApp Web load? Baseline for engagement ratios.
- **Trigger:** `content.js` after WhatsApp Web's main UI has rendered.
- **Properties:** Feature-flag snapshot derived from `chrome.storage.local` (presence of theme, slot images, font, scale, privacy mode, quick replies, visibility tweaks, animated background). All booleans / fixed-enum IDs.

#### `popup_opened`
- **Q:** Which features are configured at the moment the popup opens? Population-level snapshot.
- **Trigger:** `popup.js` DOM-ready.
- **Properties:** Same snapshot as `whatsapp_web_loaded` (booleans + `animated_background_id` from the fixed registry).

#### `analytics_flush_failed`
- **Q:** Are we losing analytics data to delivery failures? What's failing — HTTP errors, network errors, parse errors?
- **Trigger:** `flush()` catches an error sending to PostHog.
- **Properties:**
  - `error_class` *(enum)* — `"http_error" | "network_error" | "unknown"`.
  - `endpoint_status` *(number | null)* — HTTP status code if available (e.g. `503`), `null` for non-HTTP failures.
  - `batch_size` *(number)* — how many events were in the failed batch.
  - `dropped_failure_reports` *(number, optional)* — present only when the bounded self-telemetry queue overflowed since the previous report. Counts events we couldn't keep.
  - `status` *(string)* — **DEPRECATED**, mirrors `error_class`.
- **Pipeline.** This event does NOT go through the main queue. It rides a dedicated in-memory pipe with a bounded queue (10 events per service-worker lifetime) so a delivery storm cannot amplify itself. If the dedicated pipe itself fails, the event is dropped silently (recursion gate). See `analytics.js` `reportFlushFailure()` and `flushSelfTelemetry()`.

### Options page

#### `options_page_opened`
- **Q:** How many users discover the settings page?
- **Trigger:** `options.js` DOM-ready.

#### `distinct_id_copied`
- **Q:** How many users are preparing data-deletion or support requests? Proxy for GDPR/FADP workload.
- **Trigger:** User clicks the copy button next to their distinct ID on the options page.

#### `privacy_policy_link_clicked`
- **Q:** How often is the privacy policy actually read?
- **Trigger:** User clicks the privacy-policy link on the options page.

### Popup navigation

#### `popup_tab_changed`
- **Q:** Which tabs do users move between? Where do they stop?
- **Trigger:** Top-level pill nav click in `popup.html` (handler in `popup-nav.js`).
- **Properties:**
  - `from_tab` *(enum)* — `"tab-display" | "tab-backgrounds" | "tab-themes" | "tab-typography" | "tab-replies" | "tab-about"`.
  - `to_tab` *(same enum)*.

#### `quick_replies_preview_seen`
- **Q:** What share of popup sessions ever surface the quick-replies preview?
- **Trigger:** First time the Replies tab activates in a popup session (deduplicated per session).

#### `backgrounds_tab_opened`
- **Q:** What share of popup sessions ever surface the Backgrounds tab?
- **Trigger:** First time the Backgrounds tab activates in a popup session (deduplicated).

#### `typography_tab_opened`
- **Q:** What share of popup sessions ever surface the Typography tab? Symmetric with `quick_replies_preview_seen` and `backgrounds_tab_opened`.
- **Trigger:** First time the Typography tab activates in a popup session (deduplicated).

#### `settings_gear_clicked`
- **Q:** How often do users open the options page from the popup gear icon?
- **Trigger:** User clicks the gear icon in the popup header.

#### `external_link_clicked`
- **Q:** How active is feedback-driven engagement (bug reports, feature requests)?
- **Trigger:** User clicks one of the external feedback CTAs in the About tab.
- **Properties:**
  - `target` *(enum)* — `"report_bug" | "feature_request"`.

### Display tab — visibility & privacy

#### `visibility_setting_changed`
- **Q:** Which WhatsApp UI elements do users most often hide?
- **Trigger:** Any visibility checkbox flip in the Display tab.
- **Properties:**
  - `setting` *(enum)* — checkbox id (`"status" | "channels" | "communities" | "lockedChats" | "archived"`).
  - `enabled` *(boolean)* — new state.

#### `privacy_mode_toggled`
- **Q:** Do users abandon Privacy Mode after seconds or hours? Where did the toggle come from?
- **Trigger:** User flips the Privacy Mode checkbox in the Display tab.
- **Properties:**
  - `enabled` *(boolean)* — new state.
  - `trigger` *(enum)* — `"toggle_change"` today. **Forward-looking**: reserved for future entry paths (`"keyboard_shortcut"`, `"command_palette"`); the property is here now so we don't have to backfill when those paths ship.
  - `session_duration_seconds` *(number, optional)* — present only when `enabled: false`. Time since the last toggle-on transition, in seconds. Spans real time (across popup sessions) via `chrome.storage.local["privacyModeEnabledAt"]`.

### Themes — popup side

#### `theme_applied`
- **Q:** Which themes are most popular? Are presets or custom themes preferred?
- **Trigger:** User clicks a theme card (in popup, manager, or anywhere `theme_applied` should fire).
- **Properties:**
  - `theme_id` *(string)* — preset ID (e.g. `"preset-blue"`), new-format custom ID, or `"custom-legacy"` for legacy slugged IDs. Always PII-safe via `WA_SAFE_THEME_ID_FOR_ANALYTICS()`.
  - `source` *(enum)* — `"preset" | "custom"` (theme type — not the entry point).
  - `from_page` *(string, optional)* — `"manage"` when applied from the Theme Manager. Documented exception: `source` already means "theme type" here, so the entry point goes on `from_page`. Absent on popup-side applies.

#### `theme_reset`
- **Q:** How often do users revert to WhatsApp's default?
- **Trigger:** User clicks Reset in the popup Themes tab.

#### `theme_manager_opened`
- **Q:** Which entry point drove the user into the Theme Manager? Discovery funnel for theme features.
- **Trigger:** User opens `themes.html`.
- **Properties:**
  - `source` *(enum, optional)* — `"create_button" | "popup_custom_empty_state" | "popup_custom_subtab"`, absent when opened via the "Manage Items" button (historical shape preserved).

#### `themes_subtab_changed`
- **Q:** Do users with custom themes prefer that sub-tab over Presets?
- **Trigger:** Switching between Presets / Custom inside the popup Themes tab.
- **Properties:**
  - `from_subtab` *(enum)* — `"presets" | "custom"`.
  - `to_subtab` *(same enum)*.
  - `custom_theme_count` *(number)* — count at firing time. Small race possible on first sub-tab click within milliseconds of popup open; effectively zero in practice.

### Theme Manager page

#### `theme_manager_subtab_changed`
- **Q:** Which sub-tab does the user prefer on the Theme Manager?
- **Trigger:** Switching Custom / Presets in the Theme Manager.
- **Properties:**
  - `from_subtab` *(enum)* — `"custom" | "presets"`.
  - `to_subtab` *(same enum)*.
  - `custom_theme_count` *(number)*.

#### `theme_creator_opened`
- **Q:** Where do users open the Create Theme editor from?
- **Trigger:** Editor modal opens.
- **Properties:**
  - `mode` *(enum)* — `"create" | "edit"`.
  - `source` *(enum)* — `"theme_manager" | "duplicate_preset" | "duplicate_custom"`.
  - `theme_id` *(string | null)* — present only when editing an existing custom.

#### `theme_creator_closed`
- **Q:** How often do users abandon the editor without saving? Does it correlate with `had_unsaved_changes`?
- **Trigger:** Cancel / X / backdrop click / Escape (NOT a successful save — save fires `custom_theme_saved` and skips this event).
- **Properties:**
  - `mode` *(enum)* — `"create" | "edit"`.
  - `had_unsaved_changes` *(boolean)*.

#### `custom_theme_saved`
- **Q:** What features of the editor are most used? Is the simplified gradient UX (unified toggles, solid) being adopted?
- **Trigger:** Successful save.
- **Properties:**
  - `mode` *(enum)* — `"create" | "edit"`.
  - `theme_id` *(string)* — via `WA_SAFE_THEME_ID_FOR_ANALYTICS()`.
  - `name_length` *(number)*.
  - `source` *(enum)* — `"theme_manager" | "duplicate_preset" | "duplicate_custom"`.
  - `overwrote_existing` *(boolean)*.
  - `gradients_used_unified_main_bg` *(boolean)*.
  - `gradients_used_unified_wait` *(boolean)*.
  - `gradients_used_solid_count` *(number)* — 0–9.
  - `editor_version` *(string)* — `"v2"`.

#### `custom_theme_save_failed`
- **Q:** Which validation failures block users in the editor?
- **Trigger:** Save attempt blocked by validation or storage.
- **Properties:**
  - `reason` *(enum)* — `"empty_name" | "name_too_long" | "duplicate_name" | "invalid_color" | "storage_quota" | "other"`.
  - `mode` *(enum)* — `"create" | "edit"`.

#### `theme_editor_reset_to_default`
- **Q:** Are users actively undoing the editor's group affordances? Signals friction with the unified toggles.
- **Trigger:** Today, only the on→off transition of a unified toggle.
- **Properties:**
  - `field` *(enum)* — `"unified_toggle"`. Values `"color_group" | "gradient_group"` are reserved for future per-field reset buttons (not built).

#### `theme_deleted` (legacy event — kept firing)
- **Q:** Which themes get deleted, and was the deleted theme active at the time?
- **Trigger:** Custom theme deletion (after confirm).
- **Properties:**
  - `theme_id` *(string)* — safe-id.
  - `was_active` *(boolean)*.

#### `custom_theme_deleted` (new richer event — fires alongside `theme_deleted`)
- **Q:** Same as above plus deletion source — supports future deletion entry points.
- **Trigger:** Custom theme deletion (after confirm).
- **Properties:** Same as `theme_deleted` plus `source` *(enum)* — `"theme_manager"`.

#### `custom_theme_delete_cancelled`
- **Q:** How often do users back out of the delete confirm?
- **Trigger:** Delete confirm dialog dismissed (Cancel).
- **Properties:**
  - `theme_id` *(string)* — safe-id.

#### `theme_imported`
- **Q:** Which import method is preferred? Are warnings common?
- **Trigger:** End of a multi-file or URL import (success or partial success).
- **Properties:**
  - `method` *(enum)* — `"file_picker" | "url"`.
  - `added_count` *(number)*.
  - `failed_count` *(number)*.
  - `added_with_warnings` *(number)*.

#### `theme_import_rejected`
- **Q:** Which rejection codes do failed imports actually hit? Pairs with `theme_import_docs_opened`.
- **Trigger:** One per rejected file/item (so a multi-item file with all-invalid items fires multiple times).
- **Properties:**
  - `reason` *(enum)* — first code in `error_codes` (back-compat for old dashboards).
  - `method` *(enum)* — `"file_picker" | "url"`.
  - `error_codes` *(string[])* — full list of stable codes for this rejection. Var-keyed codes use the `<code>:<--key>` form (e.g. `"invalid_var_value:--main-bg-to-top"`).
  - `error_count` *(number)* — `error_codes.length`.
  - `file_size_bytes` *(number | null)* — file size for file picker; `null` for URL imports today.

**Stable `error_codes` enum (rejecting):** `not_object`, `missing_name`, `missing_vars`, `empty_vars`, `meta_not_object`, `invalid_var_key:<key>`, `invalid_var_value:<key>`, `too_large`, `parse_error`, `http_error`, `network_error`, `storage_error`.

**Warning codes (UI-only, NOT in `error_codes`):** `unknown_var_key:<key>`, `missing_recommended_keys`. These do not block imports.

#### `theme_import_docs_opened`
- **Q:** Of users who open the schema docs, what share are doing it *because* an import just failed (vs. proactive learning)?
- **Trigger:** User expands the schema-docs `<details>` in the Import dialog.
- **Properties:**
  - `had_recent_failure` *(boolean)* — true if `theme_import_rejected` fired in the same page session.

#### `theme_exported`
- **Q:** Are users moving themes between machines? (Indirect signal — exports without re-imports suggest sharing.)
- **Trigger:** User clicks Export on a custom theme card or "Export All".
- **Properties:**
  - `mode` *(enum)* — `"single" | "all"`.
  - `count` *(number)*.

#### `preset_exported_as_template`
- **Q:** Are users using preset exports to learn the JSON schema?
- **Trigger:** User clicks Export (↓) on a preset card in the Theme Manager's Presets sub-tab.
- **Properties:**
  - `theme_id` *(string)* — preset ID (e.g. `"preset-blue"`). Presets are public structure — safe to log.

#### `theme_template_downloaded`
- **Q:** Are users using the template (vs. exporting a preset)?
- **Trigger:** User clicks "Download template" in the Import dialog.
- **Properties:**
  - `source` *(enum)* — `"import_dialog"`.

### Backgrounds

#### `backgrounds_subtab_changed`
- **Q:** Which sub-tab in Backgrounds gets more attention?
- **Trigger:** Switching Static / Animated.
- **Properties:**
  - `from_subtab` *(enum)* — `"bg-static" | "bg-animated"`.
  - `to_subtab` *(same)*.
  - `from` *(string)* — **DEPRECATED**, mirrors `from_subtab`.
  - `to` *(string)* — **DEPRECATED**, mirrors `to_subtab`.

#### `animated_subtab_opened`
- **Q:** Of users who reach Backgrounds, who actually engages with animations?
- **Trigger:** First time the Animated sub-tab is selected in a popup session.
- **Properties:**
  - `has_active_animation` *(boolean)*.
  - `active_animation_id` *(string | null)* — from the fixed registry in `animated-bg.js`.

#### `image_modal_opened`
- **Q:** Which slot is opened most often?
- **Trigger:** User clicks a background slot tile in the popup.
- **Properties:**
  - `slot` *(enum)* — `"welcome" | "navside" | "sidenav" | "chatview"`.

#### `image_modal_closed`
- **Q:** What outcome do users reach in the image picker?
- **Trigger:** Image-picker modal closes.
- **Properties:**
  - `slot` *(enum)*.
  - `outcome` *(enum)* — `"saved" | "cleared" | "cancel" | "backdrop" | "esc"` (last two reserved for future shortcuts).

#### `background_slot_set`
- **Q:** Are users choosing from predefined images or their own uploads?
- **Trigger:** User saves an image to a slot.
- **Properties:**
  - `slot` *(enum)*.
  - `source` *(enum)* — `"uploaded" | "predefined"`.
  - `replaced_animation` *(boolean, optional)* — only present when `slot === "chatview"`.

#### `background_slot_cleared`
- **Q:** Which slots are most often cleared?
- **Trigger:** User clicks "None" in the image picker.
- **Properties:**
  - `slot` *(enum)*.

#### `animated_background_set`
- **Q:** Which animations are popular? Are users switching, or sticking with their first pick?
- **Trigger:** User picks an animation card.
- **Properties:**
  - `id` *(string)* — registry ID.
  - `name` *(string)* — registry title.
  - `artist` *(string | null)* — registry attribution.
  - `previous_id` *(string | null)* — prior animation, or null.
  - `is_reselect` *(boolean)* — re-applied the active card.
  - `replaced_static_chatview` *(boolean)*.
  - `source` *(enum)* — `"gallery_click" | "gallery_keyboard"`.

#### `animated_background_cleared`
- **Q:** Which animations are abandoned?
- **Trigger:** User clears the active animation.
- **Properties:**
  - `previous_id` *(string | null)*.
  - `previous_name` *(string | null)*.
  - `previous_artist` *(string | null)*.
  - `source` *(enum)*.

### Image Manager (manage-images.html)

#### `image_manager_opened`
- **Q:** How often do users reach the image library page?
- **Trigger:** User opens `manage-images.html`.

#### `image_uploaded`
- **Q:** What's the upload success rate per method?
- **Trigger:** End of an upload batch (file picker, drop, or paste).
- **Properties:**
  - `method` *(enum)* — `"picker" | "drop" | "paste"`.
  - `added` *(number)*.
  - `skipped_duplicate` *(number)*.
  - `rejected` *(number)*.

#### `image_url_added`
- **Q:** What URL outcomes do users hit?
- **Trigger:** User submits a URL.
- **Properties:**
  - `outcome` *(enum)* — `"added" | "duplicate" | "invalid_url" | "fetch_failed" | "too_large" | "wrong_mime"`.

#### `image_pasted`
- **Q:** What clipboard branch was the user on?
- **Trigger:** User presses the Smart Paste button.
- **Properties:**
  - `branch` *(enum)* — `"image_blob" | "html_img" | "text_url" | "denied" | "none"`.

#### `image_filter_changed`
- **Q:** Which filters do users use to navigate their library?
- **Trigger:** User clicks a filter pill.
- **Properties:**
  - `filter` *(enum)* — `"all" | "uploaded" | "predefined" | "disabled"`.

#### `image_deleted`
- **Q:** Which image kinds get deleted, and from which page?
- **Trigger:** Image deletion from either the popup picker or the manager gallery.
- **Properties:**
  - `kind` *(enum)* — `"uploaded" | "predefined"`.
  - `source` *(enum)* — `"popup" | "manage"`.
  - `from_page` *(string)* — **DEPRECATED**, mirrors `source`.

#### `image_restored`
- **Q:** Are users restoring stock images they disabled, or images they uploaded?
- **Trigger:** User restores a disabled image in the manager.
- **Properties:**
  - `kind` *(enum)* — `"uploaded" | "predefined"`.

### Typography

#### `font_family_changed`
- **Q:** Which fonts are tried? How much exploration before settling?
- **Trigger:** Each font dropdown change. (`font_family_session_settled` provides the destination view.)
- **Properties:**
  - `font` *(enum)* — value of the `<select>` in `popup.html`. Empty string for "Nothing".

#### `font_family_session_settled`
- **Q:** Where do users LAND when exploring fonts? Per-step `font_family_changed` answers a different question.
- **Trigger rules (exact):**
  - At most ONCE per popup session.
  - Fires on `pagehide` IFF the user changed the font at least once in this session (we use `pagehide`, not `beforeunload` — the latter fires unreliably for extension popups).
  - Also fires after 60 seconds of inactivity on the font setting (idle catch).
  - Does NOT fire if the user opened the popup but never touched the font control.
- **Properties:**
  - `final_font` *(string)* — last selected value (matches `font_family_changed.font` enum).
  - `changes_in_session` *(number)* — count of `font_family_changed` events in this popup session.

#### `font_scale_changed`
- **Q:** What scale settings are common?
- **Trigger:** User changes the font-scale slider or numeric input.
- **Properties:**
  - `scale` *(number)* — percent (e.g. 110 for 1.10).

#### `font_scale_reset`
- **Q:** Are users frequently resetting scale?
- **Trigger:** User clicks Reset on the scale row.

### Quick Replies (popup + WA Web)

#### `quick_replies_preview_seen`
*Listed under Popup navigation above.*

#### `quick_reply_first_added`
- **Q:** First-time conversion: how many users move from "interested" to "engaged" with quick replies?
- **Trigger:** First reply ever added by the user (across all sessions).

#### `quick_reply_added`
- **Q:** What's the growth curve of a user's reply library?
- **Trigger:** Each reply added in the Replies tab.
- **Properties:**
  - `total_after` *(number)* — library size after add.

#### `quick_reply_edited`
- **Q:** Do users tune their replies?
- **Trigger:** User edits an existing reply.

#### `quick_reply_deleted`
- **Q:** Library churn rate.
- **Trigger:** User deletes a reply.
- **Properties:**
  - `total_after` *(number)*.

#### `quick_reply_bubbles_shown`
- **Q:** How often do the bubbles get painted? (Useful for spotting chat-switch noise.)
- **Trigger:** Each render of the bubble bar on `web.whatsapp.com`. **Throttled to one emission per 10 seconds per page load** — without this throttle, WhatsApp's per-chat-switch DOM rebuilds would generate tens of events per minute. **When interpreting volume, account for the 10s throttle** — the count is "10-second windows that had at least one paint," not raw paint count.
- **Properties:**
  - `count` *(number)* — bubbles painted on this render (1–5).
  - `qr_count_total` *(number)* — library size at paint time.

#### `quick_reply_bubbles_session`
- **Q:** Of WA-Web page sessions where bubbles appeared, what share converted to at least one insert? Conversion-rate denominator at the *session* level — `quick_reply_bubbles_shown` answers a different question (paint frequency).
- **Trigger:** Page session unload (`pagehide` on `web.whatsapp.com`), fires only if at least one bubble was painted during the session.
- **Properties:**
  - `bubbles_shown_count` *(number)* — total across the page session (un-throttled — every paint contributes).
  - `bubbles_inserted_count` *(number)* — total click-inserts.

#### `quick_reply_inserted`
- **Q:** Which slot positions get used? Random shuffle distribution check.
- **Trigger:** User clicks a bubble on WA Web.
- **Properties:**
  - `bubble_position` *(number)* — 0–4.
  - `bubbles_shown` *(number)* — count at click time.

### WhatsApp Web in-page

#### `burger_menu_toggled`
- **Q:** Which panes do users toggle most?
- **Trigger:** User clicks a side-nav button on `web.whatsapp.com` whose visibility we manage.
- **Properties:**
  - `pane` *(enum)* — pane identifier from `content.js` (fixed set).
  - `now_visible` *(boolean)*.

### Review prompt

#### `review_modal_shown`
- **Q:** How often does the prompt appear?
- **Trigger:** Modal is rendered.
- **Properties:**
  - `deferred` *(boolean)*.
  - `session_count` *(number)*.

#### `review_modal_action`
- **Q:** What share of users review vs. defer vs. dismiss?
- **Trigger:** User picks one of the modal's CTAs.
- **Properties:**
  - `action` *(enum)* — `"review" | "defer" | "dismiss" | "never"`.
  - `deferred` *(boolean)*.

---

## Skipped on purpose

The following moments are explicitly NOT tracked. Each has been considered and rejected to keep the event taxonomy actionable.

- **Scroll, hover, mouse-move.** Pure UI noise.
- **About tab first-seen.** About is intentionally static.
- **Display tab first-seen.** Default tab — every `popup_opened` implies it.
- **Per-control telemetry inside the theme editor** (which color picker was touched). `custom_theme_saved`'s summary properties answer the actionable questions.
- **Drag-enter on the import drop zone.** The upload result already covers the funnel.
- **Schema docs scroll depth.** Open is the signal; depth is noise.
- **Reset-when-already-default events.** Visible from existing event ratios.
- **`extension_startup` / `extension_idle`.** Lifecycle noise — not feature engagement.

---

## Operational notes

- **PostHog project setting:** IP geolocation disabled at the project level. The extension does not send IP-derived properties.
- **Distinct ID lifecycle:** generated once on first install. Survives extension updates. Cleared only if the user wipes extension storage or uninstalls.
- **No opt-out toggle today.** Disclosure runs through the privacy policy and the options page (which surfaces the distinct ID for deletion requests). See `options.html` for the user-visible language.
- **Service worker teardown:** events queued via `track.js` are forwarded to the SW via `chrome.runtime.sendMessage`; if the SW is torn down, the message is delivered on its next wake. Events captured in the popup, options page, and content scripts therefore tolerate SW lifecycle gaps.

## Adding new events

1. State the question first. If you can't write the question in one sentence, the event is wrong.
2. Pick stable enum values for any non-numeric property — no English error messages in `reason`/`error_class`/etc.
3. Run through the PII contract before merging — every value either comes from a fixed enum, is a count/duration, or is an extension-owned ID. Theme IDs go through `WA_SAFE_THEME_ID_FOR_ANALYTICS()`.
4. Add a `// Q:` comment above the `window.track()` call site.
5. Add a row to this file under the right section. Include all properties and their enums.
6. For renames of existing properties, use dual-write for ≥2 release cycles and add a row to the "Dual-write deprecations" table above.
