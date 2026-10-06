# Changelog

## 2.1.0

- Add declarative preloading, page polling, reactive partial loading, optional view transitions, a progress indicator, validation focus, scroll restoration and asset-version checks.
- Bound the preload cache, separate request variants, deduplicate speculative fetches and invalidate stale entries around writes and fresh foreground reads. Cached navigation retains cancellation, loading and error handling.
- Keep partial hosts mounted while reconciling their contents. Stop observers, timers and requests when a host is removed; handle partial errors locally and support the module build without a global Alpine instance.
- Prevent deferred transitions, stale scripts and older responses from taking over a newer navigation. Propagate DOM-update failures while tolerating skipped animations.
- Preserve application history state and outgoing scroll coordinates, restore back/forward positions, and decode anchor IDs.
- Execute fragment scripts once through the explicit script handler, including append mode. Honor script opt-out and preserve inert data scripts.
- Refresh assets through a full navigation to the intended destination. Speculative preloads cannot reload the page.
- Add regression tests for request/cache races, cleanup, focus, scripts and progress; expand randomized DOM reconciliation and browser/PHP integration checks.

### Preview migration

Early v2.1 previews replaced the `x-partial` host itself. The release retains that host and reconciles its children. Return the content to place inside it, and place persistent controls/loading indicators outside the host. Use one partial state per host. Preloads must return the same complete render envelope as navigation.
