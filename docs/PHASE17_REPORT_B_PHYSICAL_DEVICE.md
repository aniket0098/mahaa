# Phase 17 — Report B: Physical-Device Verification — BLOCKED

**Date:** 2026-10-11 · **Status:** ⛔ **BLOCKED — no physical Android device attached**

## 1. Blocker

`adb devices -l` returns an empty list (exit 0):

```
List of devices attached
<no entries>
```

- ADB: `C:\Users\danik\AppData\Local\Android\Sdk\platform-tools\adb.exe` (v37.0.1) — present and working.
- No USB device with debugging authorized, and no emulator running.

Per this phase's rule — *only automate what exists; state missing
infrastructure honestly* — **no device-side checks were performed and none
were simulated.** This report is the blocker documentation.

## 2. What could not be executed (deferred to the device phase)

1. Install the app on a physical Android device.
2. Login flow (valid credentials, invalid credentials, session persistence).
3. Navigation across the candidate tab set (each tab opens, no crash, no blank screen).
4. Messaging on-device: connect → conversation → send/receive → message-request state machine.
5. Error handling on-device: offline / bad-gateway banner, 401 redirect to login.
6. Regression pass: feed, stories, posts, profile.

## 3. Preconditions already verified

| Precondition | State |
|---|---|
| ADB on machine | ✅ v37.0.1 at SDK platform-tools |
| Android Gradle project | ✅ `android/` present (`npx expo run:android` applicable) |
| Metro dev server | ✅ running on 8081 (pre-existing, untouched) |
| Message-service stack | ⚠️ stopped — restart first (see §4) |
| Backend API :8000 | ⚠️ stopped — restart first (see §4) |
| Automated suites | ✅ backend 134/134, message-service 61/61, mobile 990/990, E2E 21/21 (Report A) |

## 4. Startup sequence for the device phase

```powershell
# 1. services
cd C:\mahaa\message-service; docker compose up -d --build
cd C:\mahaa\backend; .venv\Scripts\python -m uvicorn app.main:app --port 8000
# 2. device
C:\Users\danik\AppData\Local\Android\Sdk\platform-tools\adb.exe devices -l  # must list 1 device
# 3. app (development build; accept the USB-debugging RSA prompt on the phone)
npx expo run:android
```

## 5. Exit criteria for the re-run

- `adb devices -l` lists exactly one `device` (not `unauthorized` / `offline`).
- All six checks in §2 pass, with `adb logcat` captured and free of `FATAL` / `AndroidRuntime` errors during the session.
- Existing automated suites stay green (no regressions).
