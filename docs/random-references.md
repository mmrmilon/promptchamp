# Shared and random reference images

Every event has an image assignment setting, independent of its demo/live AI mode. Existing and new events default to **Shared image**. Their single reference, prior results, timers and registration links are preserved.

## Host a random-image challenge

1. Create a new event and choose **Random unique — different for each team**, or change this on a draft before teams register.
2. In **Random reference pool**, select PNG/JPEG/WebP files and choose **Add images**. Maximum 2 MiB each, up to 100 images per event. Exact duplicate files are rejected; different encodings of the same picture are not detected. Choose different images with similar difficulty.
3. Open registration and share the QR code as usual. Add/remove pool images while registration remains open, before assignments exist.
4. Before locking, provide at least as many images as registered teams. Five teams need at least five images; extra images are allowed. Locking with too few images fails without partially assigning anyone.
5. **Close registration and lock draw** saves a random assignment for each team without repeats. Repeating the request does not redraw. Lucky numbers still control order.
6. Call each team normally. The image appears only after Start. Refresh, recovery, scoring retry and replacement generation retain the assigned reference.

The pool freezes once the draw locks. Already-live events cannot switch to random images. Duplicate an event to copy its setup and pool into a fresh draft without teams or assignments.

## Present the current team

Choose **Present current team** in the queue. `/present?event=EVENT_UUID` uses the host's existing account or transition session. Open it on the host computer, move the window to the projector, and select **Full screen** or F11.

It follows the called/active team, then the latest started turn when no team is called. It shows the team, lucky number, timer, reference after Start, submitted prompt and processed result. Unsubmitted drafts and future assignments are excluded. Demo output is labeled as simulated. The screen polls every two seconds and counts down against server time.

The link itself does not grant access: signed-out or other-workspace users cannot fetch state or images. Keep the host browser signed in. Use the public registration QR page for joining, not this URL. Private content clears when polling reports an authorization failure.

## Data and scoring

Migration `005_random_references.sql` adds `events.reference_mode`, private `reference_pool_images`, and saved `round_entries.reference_image_id`. Composite foreign keys keep references in their own event; a partial unique index prevents repeats among current entries in a round. Existing shared references remain in `reference_images` for compatibility.

Assignments use a cryptographic shuffle inside the draw-lock transaction. Team reference reads, demo sample images and live judging resolve the same saved reference. Processing retries neither select another image nor reset the timer. The existing judging rubric and AI quotas remain in effect. Different pictures may still differ in difficulty; review them before play.
