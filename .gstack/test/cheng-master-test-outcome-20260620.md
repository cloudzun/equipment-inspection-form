# QA Test Outcome — 2026-06-20
Branch: master | URL: http://localhost:3000 | Tier: Quick

## Health Score: 92/100

| Test | Result |
|------|--------|
| Page loads | PASS |
| Device pre-fill from URL | PASS |
| Status pill interaction | PASS |
| Inspector + note fields | PASS |
| Submit → toast → 2s clear | PASS |
| Submit → API persistence | PASS |
| History — by device | PASS |
| History — by inspector | PASS |
| History — date range | PASS |
| Validation — required fields | PASS |
| XSS — script rendered as text | PASS |
| Mobile viewport (375x812) | PASS |
| Unicode (中文) round-trip | PASS |
| Concurrent submits | PASS |
| ISSUE-001: ?view=history routing | FIXED |

## Issues
- ISSUE-001: ?view=history not auto-switching (fixed, 3a78c95)
- ISSUE-002: 500 errors on history page load (browser transient, low)
- ISSUE-003: Status pills missing ARIA roles (deferred, accessibility)

## Fix Commits
- 3a78c95: fix(qa): ISSUE-001 — ?view=history routing
- 1f41544: fix(qa): revert HOST default to 0.0.0.0
