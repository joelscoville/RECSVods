# Screen Behavior And Hierarchy

This file supplements the frame exports with behavior that a static image cannot fully convey.

## Desktop Home

- A 151px navigation region places `RECS REPLAY` at left and the wide search field to its right.
- The returning-user state leads with a dark indigo call-to-action containing `Pick up where you left off` and a featured video.
- The new-user state uses the same structure with `Watch the latest sermon`.
- Supporting videos use a four-column card row at the 1728px reference width.
- Category tiles follow the video row and use the established indigo, navy, burgundy, and periwinkle palette.
- The footer uses dark indigo with the wordmark and simple Home/Policies links.

## Mobile Home Portrait

- Use a compact wordmark/search header followed by horizontally scrollable filter chips.
- The selected `All` chip uses burgundy and a non-color selected cue.
- The featured card sits on an indigo field and becomes `Continue watching` for returning users.
- Remaining videos form a single vertical feed with full-width media surfaces.
- The footer stacks links and remains part of normal document flow.

## Mobile Home Landscape

- Treat landscape as a distinct compact layout rather than stretching portrait.
- Keep the header and essential browsing controls visible without compressing tap targets.
- The two source frames named `Landscape` are 844 by 1367 and document the complete page, not a 390px-tall viewport screenshot.
- At an actual 844 by 390 viewport, keep the page scrollable rather than shrinking the complete feed to fit.

## Mobile Search Portrait

- Top row: 44px Back control and `Search` title.
- Burgundy pill search input with periwinkle search action.
- Sections: `Your history`, `Search by category`, and `Trending searches`.
- History/trending use wrapping chips. Categories use a two-column tile grid.
- When the real keyboard opens, keep the query field and submit/back controls visible; allow lower-priority content to scroll or move out of view.
- Do not implement the drawn keyboard.

## Mobile Search Landscape

- Search navigation occupies the top row.
- History and category content use side-by-side columns where space permits.
- The keyboard-safe state reserves the lower viewport for the real keyboard.

## Desktop Playback

- The dark playback region contains a large 16:9 player on the left and a chapter panel on the right.
- The player includes title/channel context, central play affordance, progress, elapsed/total time, captions, and fullscreen affordances through the real YouTube embed.
- Chapter rows show timestamp, title, and short summary. Active state requires more than color.
- Below the player, display title, service type, scripture, duration, and a concise summary.
- The global navigation/search and footer remain consistent with desktop home.

## Mobile Playback Portrait

- Stack the 16:9 player, title/metadata, summary, divider, and chapters.
- Keep Back reachable at the top-left of the player region.
- Chapter cards are approximately 358 by 88px at the 390px reference width.
- The active chapter uses a filled periwinkle treatment plus a textual or icon cue.
- The page scrolls; do not shrink chapters to fit one viewport.

## Mobile Playback Landscape

- Prioritize the 16:9 player across the available width.
- Place Back in a separate reachable 44px control.
- Hide or defer lower-priority metadata rather than overlaying it on controls.

## Search Results Gap

The source file has no complete desktop result-list frame. Build desktop results by combining:

- The desktop `NAV` component.
- Video-card typography and media treatment.
- Chapter-row timestamp/title/summary hierarchy.
- The mobile search chip and match-state language.
- The standard footer.

Each result must display title, date, service/section type, speaker when known, scripture, summary, relevant timestamp range, match reason, `Play passage`, and `View full sermon`. Preserve the existing palette and spacing rhythm; do not introduce generic dashboard cards.
