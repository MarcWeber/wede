So we have log | follow-open | follow-open-live    log only logs, follow-
open only opens the tab (not focusing it) and follow-open-live follows the
cursor and if cursor is closer than like 10% of borders top/left/bottom/ 
right tries to move it into the middle ?


GOALS:
========

session mode
    follow-strict:
    teacher does, student can watch.
    This means if a tab gets opened, it gets opened everywhere and focuses

    follow-lazy:
    tabs open, but don't change the focus, so joining would be fast and easy
    and it allows the teacher to look at other tabs while listening

no-disconnected-mode (or each user has different session mode)?

    every login has its own session everybody can do what he/she wants.
    This pr

    Thus if 2 users have sessions S1 and S2 and they want to join
    they can login again .. might be good enough.


Thus if sessions had a name or *random-name* the job would be done already ?

IMPLEMENTED v1 (2026-11-12)
===========================

- follow-open: opens every tab in the target's published open-tab list,
  without changing focus. New tabs opened later are also opened.
- follow-live: focuses the target's active file and reveals the cursor line.
- Teacher lead: server-presenter forces every other client into follow-live.
  Local personal follow target is restored when the forced lead ends. The
  presenter's own personal follow is paused while they lead, so their view is
  not dragged around by the person they were following.
- Presence publishes `tabs`; follow-open reconciles the inventory: target opens
  -> follower opens, target closes -> follower closes only tabs this follow
  opened. Modified/locked tabs are never closed. No explicit tab.close message;
  the close is derived from the inventory diff.
