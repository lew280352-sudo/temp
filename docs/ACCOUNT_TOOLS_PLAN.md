# First use and signed-in devices

The owner requested first-use setup, device management, preserved legacy accounts, a durable free HTTPS host and real service checks. Existing purple/lime branding remains the visual authority.

Design tokens: dark base `#14101d`, content `#211b2c`, text `#f1edf7`, muted `#b8aec7`, rule `#3b314a`, action `#d8f68a`. Keep Inter/Noto Sans Thai, 30px page headings and 13–14px controls. Left-aligned pages use the app's existing header and floating navigation.

```text
First use: [ heading and explanation                       ]
           [ select supported companies | select RSS feeds ]
           [ save and open news        | skip              ]
Devices:   [ heading                    | refresh          ]
           [ current device, activity, expiry, sign out    ]
           [ other devices, activity, expiry, sign out    ]
           [ sign out other devices                       ]
```

On mobile the setup sections and device details stack. Company options are real supported companies, with existing local logos; no sample price or fabricated news. Checkboxes retain drafts on errors. Destructive session actions require confirmation and maintain visible keyboard focus. Prefer one setup page over a modal wizard that could hide recovery information or block normal navigation.

New accounts get pending setup metadata stored separately from news preferences. Legacy accounts are not automatically marked new. Completing setup saves preferences and completion in one transaction with revision and session checks; skipping preserves preferences. The welcome route remains available for revisiting setup.

Device records use opaque public IDs unrelated to bearer tokens, coarse browser/OS names, creation/activity/expiry timestamps and a current-device flag. No IP or raw user agent is retained. Revocation is scoped to the current account and checked inside a transaction. Existing sessions receive anonymous legacy records, preserving login. New Push subscriptions are linked transactionally to their session; session removal removes linked subscriptions before another delivery. Legacy Push subscriptions without a known session stay intact through migration.

Account migrations and public cutover require the original source database and connected provider accounts. Neither the empty preview database nor empty Docker smoke-test volume proves the original account data is absent. The owner later authorized a fresh database on 6 November 2026, superseding the original import prerequisite. Use a separate new database without deleting original files; do not claim handset notification delivery from an automated browser test.
