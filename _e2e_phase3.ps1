# Live E2E verification — scratch harness (delete after run). Creates one throwaway
# candidate, exercises the Phase 3 flows the mobile app calls, then deletes the account.
$api = 'http://127.0.0.1:8000/api/v1'
$stamp = Get-Date -Format 'yyyyMMddHHmmssfff'
$script:pass = 0; $script:fail = 0

function Check([string]$name, $cond, $detail = '') {
    if ($cond) { $script:pass++; "PASS  $name $detail" }
    else { $script:fail++; "FAIL  $name $detail" }
}
# Returns exactly TWO pipeline items. Never `,@(...)`: PowerShell 5.1 does not unpack a
# single returned array in `($r, $c) = <command>` — the whole pair lands in $r and $c
# stays $null, so every "expected 4xx" check fails while success checks pass by luck
# (member enumeration finds StatusCode on the first array element).
function StatusOf([scriptblock]$blk) {
    try { $r = & $blk; $r; $null } catch {
        $code = $null
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $null; $code
    }
}

# --- 1. create a throwaway candidate -----------------------------------------
$name = 'E2E Verify User'
$email = "e2e.verify.$stamp@example.com"
$pw = 'E2eVerify123'
$sr = Invoke-WebRequest -Method Post -Uri "$api/auth/signup" -ContentType 'application/json' `
    -Body (@{ name = $name; email = $email; password = $pw; role = 'candidate' } | ConvertTo-Json) -UseBasicParsing
$signup = $sr.Content | ConvertFrom-Json
Check 'signup status=201' ($sr.StatusCode -eq 201)
Check 'signup returns access_token' ($null -ne $signup.access_token)
# V1 has no refresh token — backend/app/schemas/auth.py: "No refresh token in V1."
# Asserting its absence is the real contract, not its presence.
Check 'signup returns expires_in, no refresh_token' ($null -ne $signup.expires_in -and $null -eq $signup.refresh_token)
# Lowercase "bearer" — the schema pins it and the integration suite asserts the exact string.
Check 'signup token_type=bearer' ($signup.token_type -eq 'bearer')

# --- 2. login with the same credentials --------------------------------------
$login = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType 'application/json' `
    -Body (@{ email = $email; password = $pw } | ConvertTo-Json)
Check 'login returns access_token' ($null -ne $login.access_token)
Check 'login token differs from signup token' ($login.access_token -ne $signup.access_token)

$hdr = @{ Authorization = "Bearer $($login.access_token)" }

# --- 3. wrong password rejected ------------------------------------------------
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$api/auth/login" -ContentType 'application/json' -Body (@{ email = $email; password = 'WrongPass123' } | ConvertTo-Json) -UseBasicParsing }
Check 'bad password rejected (4xx)' ($c -ge 400 -and $c -lt 500)

# --- 4. /auth/me identifies the user ------------------------------------------
$me = Invoke-RestMethod -Uri "$api/auth/me" -Headers $hdr
Check '/auth/me email matches' ($me.email -eq $email)
Check '/auth/me role=candidate' ($me.role -eq 'candidate')

# --- 5. onboarding state (drives resolveEntryPath) ----------------------------
$ob = Invoke-RestMethod -Uri "$api/onboarding/state" -Headers $hdr
$obKeys = $ob.PSObject.Properties.Name
# Contract per backend/app/schemas/onboarding.py: role, state, percent, next_step, steps[{key,...}].
Check 'onboarding/state has state' ($obKeys -contains 'state')
Check 'onboarding/state has percent' ($obKeys -contains 'percent')
Check 'onboarding/state has steps' ($obKeys -contains 'steps')
Check 'onboarding state=not_started for new user' ($ob.state -eq 'not_started')
Check 'onboarding next_step resolves to a listed step' (@($ob.steps | Where-Object { $_.key -eq $ob.next_step }).Count -eq 1)

# --- 6. profile completeness (server-derived, used by dashboard) ---------------
$pc = Invoke-RestMethod -Uri "$api/profile/completeness" -Headers $hdr
# Contract per backend/app/schemas/profile.py: percent + sections[{key,weight,earned,...}].
Check 'profile/completeness has percent' ($null -ne $pc.percent)
Check 'profile/completeness has sections' ($null -ne $pc.sections)
Check 'completeness percent within 0..100' ($pc.percent -ge 0 -and $pc.percent -le 100)
Check 'section weights sum to 100' ((@($pc.sections) | Measure-Object -Property weight -Sum).Sum -eq 100)

# --- 7. courses list (Learning Hub catalog) -----------------------------------
$courses = Invoke-RestMethod -Uri "$api/courses" -Headers $hdr
Check 'courses list returns items' ($null -ne $courses.items)

# --- 8. enroll -> my enrollments -----------------------------------------------
$enrolledOk = $false
$enrolledCourseId = $null
if (@($courses.items).Count -gt 0) {
    $first = @($courses.items)[0]
    $enrolledCourseId = $first.id
    try {
        Invoke-RestMethod -Method Post -Uri "$api/courses/$enrolledCourseId/enrollment" -Headers $hdr -ContentType 'application/json' -Body '{}' | Out-Null
        $enrolledOk = $true
    } catch {
        $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        # 409 = already enrolled; still counts as a working endpoint
        $enrolledOk = ($code -eq 409)
    }
}
Check 'enroll endpoint reachable' $enrolledOk
$mine = Invoke-RestMethod -Uri "$api/courses/enrollments/mine" -Headers $hdr
Check 'my enrollments lists enrolled course' (@($mine.items | Where-Object { $_.enrollment.course_id -eq $enrolledCourseId }).Count -ge 1)

# --- 9. course detail matches list --------------------------------------------
if ($enrolledCourseId) {
    $detail = Invoke-RestMethod -Uri "$api/courses/$enrolledCourseId" -Headers $hdr
    Check 'course detail id matches' ($detail.id -eq $enrolledCourseId)
    # The course body carries `sections` — content lives under sections, not a
    # top-level `lectures`/`modules` array.
    Check 'course detail has sections key' ($detail.PSObject.Properties.Name -contains 'sections')
}

# --- 10. clean up: deactivate/delete the throwaway account --------------------
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$api/users/me/deactivate" -Headers $hdr -UseBasicParsing }
Check 'account deletion/deactivate endpoint reachable' ($r.StatusCode -eq 200 -or $c -eq 200 -or $c -eq 204 -or $c -eq 409)

# Deactivate is a SOFT pause (backend/app/api/v1/endpoints/users.py): status becomes
# `deactivated`, nothing is revoked (V1 has no revocation list), and only SUSPENDED
# is refused by get_current_user. So the existing token still answers auth/me — a 401
# here would contradict the documented contract.
($r, $c) = StatusOf { Invoke-WebRequest -Uri "$api/auth/me" -Headers $hdr -UseBasicParsing }
Check 'after deactivate, token still valid (soft pause, no revocation)' ($r.StatusCode -eq 200)

# And "signing in again reactivates" — login must succeed after deactivation.
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$api/auth/login" -ContentType 'application/json' -Body (@{ email = $email; password = $pw } | ConvertTo-Json) -UseBasicParsing }
$relogin = if ($r) { $r.Content | ConvertFrom-Json } else { $null }
Check 'login after deactivate reactivates the account' ($r.StatusCode -eq 200 -and $null -ne $relogin.access_token)

# Leave the throwaway paused, as the header promises: the reactivation check above
# undid the first deactivate, so pause it again with the fresh token.
$hdr2 = @{ Authorization = "Bearer $($relogin.access_token)" }
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$api/users/me/deactivate" -Headers $hdr2 -UseBasicParsing }
Check 'throwaway account left deactivated' ($r.StatusCode -eq 200)

"`nTOTAL: $script:pass passed, $script:fail failed"
