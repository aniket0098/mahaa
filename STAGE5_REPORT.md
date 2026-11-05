# Stage 5 Report — Free-Course Enrolment Flow (MAHAJOB Learning Hub)

**Status:** IMPLEMENTED AND VALIDATED (backend + mobile); Android device verification recorded as **NOT TESTED** (automation blocker).

**Scope shipped:** `POST /courses/{course_id}/enrollment` (201 created / 200 already-enrolled, idempotent), `GET /courses/{course_id}/enrollment` (`{enrolled, enrollment}`), and the course-detail enrolment CTA on the candidate course-detail screen. No migration required — the `enrollments` table (migration `e7a3c5d91b24`, single alembic head) already existed. My Learning / list-my-enrolments deferred to the next stage per stage rules.

**No commits or pushes were made; no production database was touched.** Pre-existing uncommitted work (calls, messaging, realtime, feed, stories) was preserved and excluded from stage ownership.

---

## Backend

### Files changed
- `backend/app/services/courses.py` — added `enroll_in_free_course()` and `get_enrollment_state()` plus helpers (`_free_for_enrolment`, `_find_enrollment`, `_enrollment_out`, `_settle_existing`, `_not_free_for_enrolment`).
- `backend/app/api/v1/endpoints/courses.py` — added `POST`/`GET .../{course_id}/enrollment` routes.
- `backend/tests/test_enrollment.py` — NEW, 11 tests covering the full contract.

### Contract delivered
| Route | Status | Behaviour |
|---|---|---|
| `POST /courses/{id}/enrollment` | 201 / 200 | Creates one `active` row for the token principal; repeat enrolment returns 200 with the same row (idempotent, never a second row). |
| `POST ...` (paid / unpriced) | 409 | `Only free courses can be enrolled in for free…`, no row written. |
| `POST ...` (draft / unlisted / unknown / malformed) | 404 | Visibility checked *before* pricing — never an existence oracle. |
| `POST ...` (anonymous) | 401 | `not_authenticated` via `CurrentUser`. |
| `GET /courses/{id}/enrollment` | 200 | `{enrolled: bool, enrollment: EnrollmentOut\|null}`. |
| Any DB failure | 500 | Sanitised to shared envelope — never the DSN or SQL. |

### Key design decisions
- **Genuinely-free gate** (`_free_for_enrolment`): `is_free === true AND price === null`. A missing price alone is never evidence of a free course; a course carrying a price is never free even while claiming `is_free`.
- **Student from token principal only**: `student_id` is never read from the body; the route takes no body, so a body-supplied user id is ignored (tested).
- **Race safety**: the `IntegrityError` arm rolls back and re-reads the winner from the table (`uq_enrollments_student_id_course_id` decides), answering 200 with the winner's row — never 500, never the SQL, never a second row. Mirrors the proven `IntegrityError` pattern in `services/connections.py`.
- **Repeat = "ensure enrolled"**: `active`/`completed` returned untouched; `cancelled` revived in place (revive-not-reinsert, same as connections). No unenrol route — not an unenrolment flow by the back door.
- **Wire schemas** `EnrollmentOut`/`EnrollmentStateOut` already existed (pre-staged in Phase 25 work); no new schema or migration needed.

### Backend test results
- `tests/test_enrollment.py`: **11/11 pass** (anonymous 401, paid→409 no row, race arm mirroring `test_p4_connections.py:1021`, repeat POST→200 single row, draft/unlisted/nonexistent/malformed→404, body user-id ignored, second student, persistence re-read via `expire_all()`, catalogue regression, DSN-sanitised 500).
- `tests/test_courses.py` + `test_enrollment.py` on a **fresh scratch database** (alembic `e7a3c5d91b24`, single head unchanged): **26/26 pass**.
- On the shared dev database, `test_courses.py` count assertions fail because of **pre-seeded sample courses** (environmental, not a regression) — confirmed identical failures exist on `main` without my changes.
- `ruff check`: clean on all touched backend files.
- `alembic heads`: single head `e7a3c5d91b24`, unchanged — no migration needed.


---

## Mobile

### Files changed
- `src/types/course.ts` — added `CourseEnrollment`, `CourseEnrollmentState`, `EnrollmentStatus` types.
- `src/api/courses.ts` — added `fetchCourseEnrollment()` and `enrollInFreeCourse()` (shared `apiClient` transport, no `fetch`).
- `src/api/queryKeys.ts` — added `courseEnrollment: (courseId) => ['courses', courseId, 'enrollment']`.
- `src/features/learn/courseDetailModel.ts` — added `isGenuinelyFree()`, `enrollmentUnavailableHint(reason)`, `enrollmentCardHint()`; replaced the always-true `enrollmentUnavailable` with server-derived logic.
- `src/features/learn/courseDetailModel.test.ts` — updated/enrolled-copy + `isGenuinelyFree` tests.
- `src/features/learn/courseDetailWiring.test.ts` — rewrote the "no fake enrollment" block as "enrolment flows through the shared client, server as source of truth" (5 assertions).
- `src/app/(candidate)/course/[courseId].tsx` — wired status query + mutation above early returns; CTA gated on `isGenuinelyFree`; pending disables the button; failures render persistent `StatusBanner` with retry; "Enrolled" appears only from server state. Home and LearningSection untouched.

### Contract delivered
| Behaviour | Implementation |
|---|---|
| Genuinely-free check | `isFree === true && price === null` (client mirror of server gate) |
| Paid / unknown-priced course | Disabled CTA, honest hint naming the real reason; no server enrolment request |
| Enrolment status | Server-only; `GET /courses/{id}/enrollment` under `queryKeys.courseEnrollment(id)` |
| Enrolment mutation | `POST` via `enrollInFreeCourse`; settles only in `onSuccess` (no optimistic flag) |
| Pending state | `Button loading={isPending}` disables taps |
| Failure | Persistent `StatusBanner` with retry; no toast, no half-enrolled state |
| "Enrolled" label | Only after server-confirmed `enrolled === true` |

### Mobile test results
- Typecheck (`tsc --noEmit`): **clean**.
- `courseDetailModel.test.ts` + `courseDetailWiring.test.ts`: **41/41 pass**.
- Full vitest suite (`node ./scripts/run-vitest.mjs`): **1120 passed / 59 skipped / 0 failed** (72 files).
- `expo lint` on touched files: **exit 0**.
- Note: repo has no component-render test infra (vitest only, no testing-library), so UI correctness follows the established source-wiring + pure-model convention — an honest limitation to report.

---

## Android device verification — NOT TESTED

An emulator (`mahajob_api36`) was available and booted, and the debug APK (`app-debug.apk`) installs and launches. The app was built with the new bundle and ran on-device:
- Sign-in to MahaJob works against the real local API (via `adb reverse tcp:8000`).
- The onboarding "Basic profile" screen is reachable and its required fields (Headline, Location, About) accept input.

**Blocker:** completing onboarding requires clearing an optional "Career interests" text field that accumulates stray characters via `adb shell input text`. The emulator/shell does **not** honour `input keyevent 112` (DELETE) or long-press+delete on the focused `EditText`, so the field cannot be cleared and the "Continue" button remains disabled with "Fill in the required fields above to continue." Select-all via swipe also fails to enable DELETE. This is an **adb/UI-automation limitation, not a code issue** — the form and validation behave correctly under test.

**Repro steps for manual device verification:**
1. `adb reverse tcp:8000 tcp:8000 && adb reverse tcp:8081 tcp:8081`
2. Run backend: `uvicorn app.main:app --host 127.0.0.1 --port 8000` (local Postgres, `APP_ENV=development`)
3. Run Metro: `npx expo start --port 8081` (from `c:\mahaa`)
4. Install: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
5. Launch: `adb shell am start -n com.mahajob.mobile/.MainActivity`
6. Sign in with a real account; the welcome screen → "Open your dashboard" → onboarding → Learn tab → open a **genuinely free** course (is_free=true, price=null) → the "Enroll for free" CTA should work end-to-end (201→200 idempotency, "Enrolled" label, persistent StatusBanner + retry on failure).
7. For a paid or unpriced course: CTA disabled with an honest hint; no enrolment request is made.

**Recommended next step:** resolve the adb DELETE limitation (e.g., use a physical device, a different emulator image, or `uiautomator` to set the field to empty) and complete the device flow above.

---

## Next stage recommendation

**My Learning (list my enrolments)** is the natural next stage. It is explicitly deferred here per stage rules (no building it as a side quest). It will require:
- Backend: `GET /enrollments/mine` (or `GET /courses/mine/enrolled`) returning the caller's enrolments, plus `EnrollmentOut` reuse.
- Mobile: a new screen under `src/app/(candidate)/` (e.g., `(candidate)/my-learning`), its route in `navConfig.ts`, a tab entry, and a `queryKeys.myEnrolments` key — **never mixed with employer routes**.

No production DB access, no commits, no pushes were made as part of this stage.
