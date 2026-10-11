/* SlipFit release notes. The newest entry's version IS the app version: bump
 * it here, in index.html's ?v= query strings and in sw.js's CACHE together.
 * The What's new sheet shows the entries newer than the last one you saw. */
(function (root) {
  'use strict';
  const CHANGELOG = [
    {
      v: '1.0.1', d: '2026-10-11', title: 'Safer sync',
      items: [
        'Turning on sync on a second device no longer overwrites your account with that device\'s empty data.',
        'When this browser and your account both changed, SlipFit now asks which to keep instead of guessing.',
      ],
    },
    {
      v: '1.0.0', d: '2026-10-11', title: 'SlipFit is here',
      items: [
        'Today screen: your planned session, weekly goal ring, streak, XP and daily check-ins.',
        'Workout logger: 120 exercises, last-time numbers pre-filled, progression suggestions, rest timer and live PRs.',
        '10 built-in programs (Beginner Full Body, Upper/Lower, Push/Pull/Legs, Couch to 5K and more) plus a plan generator.',
        'Goals with deadlines and projected finish dates.',
        '12 calculators: calories and macros, body fat, 1RM, plate loader, heart-rate zones, pace and more.',
        'Progress charts, a PR board, a training heatmap and 46 achievements.',
        'Works offline, installs to your home screen, and syncs between devices when you sign in.',
      ],
    },
  ];
  root.FitChangelog = CHANGELOG;
  root.FIT_VERSION = CHANGELOG[0].v;
})(this);
