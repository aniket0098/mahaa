# Local-first verification — live HTTP flow (scratch harness; delete after run).
$api = 'http://127.0.0.1:8000/api/v1'
$msg = 'http://127.0.0.1:8001/api/v1'
$stamp = Get-Date -Format 'yyyyMMddHHmmssfff'
$script:pass = 0; $script:fail = 0
function Check([string]$name, $cond, $detail = '') {
    if ($cond) { $script:pass++; "PASS  $name $detail" }
    else { $script:fail++; "FAIL  $name $detail" }
}
# Returns exactly TWO pipeline items. Never `,@(...)`: PowerShell 5.1 does not unpack a
# single returned array in `($r, $c) = <command>` — the whole pair lands in $r and $c
# stays $null, so every "expected error code" check fails while success checks pass by
# luck (member enumeration finds StatusCode on the first array element).
function StatusOf([scriptblock]$blk) {
    try { $r = & $blk; $r; $null } catch {
        $code = $null
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $null; $code
    }
}

# --- 1. signup two throwaway users (backend :8000) ---------------------------
$passA = 'VerifyLocal123'
$ra = Invoke-RestMethod -Method Post -Uri "$api/auth/signup" -ContentType 'application/json' `
    -Body (@{ name = 'Local Verify A'; email = "local.a.$stamp@example.com"; password = $passA; role = 'candidate' } | ConvertTo-Json)
$rb = Invoke-RestMethod -Method Post -Uri "$api/auth/signup" -ContentType 'application/json' `
    -Body (@{ name = 'Local Verify B'; email = "local.b.$stamp@example.com"; password = $passA; role = 'candidate' } | ConvertTo-Json)
Check 'signup A (backend)' ($null -ne $ra.access_token)
Check 'signup B (backend)' ($null -ne $rb.access_token)

$hdrA = @{ Authorization = "Bearer $($ra.access_token)" }
$hdrB = @{ Authorization = "Bearer $($rb.access_token)" }

# --- 2. auth compatibility: backend /auth/me with each token ------------------
$meA = Invoke-RestMethod -Uri "$api/auth/me" -Headers $hdrA
$meB = Invoke-RestMethod -Uri "$api/auth/me" -Headers $hdrB
$idA = $meA.id; $idB = $meB.id
Check 'backend /auth/me (A)' ($idA -and $meA.email -like 'local.a.*')
Check 'backend /auth/me (B)' ($idB -and $meB.email -like 'local.b.*')

# --- 3. message service accepts the SAME backend tokens (compat) -------------
($r, $c) = StatusOf { Invoke-WebRequest -Uri "$msg/message-requests" -Headers $hdrA -UseBasicParsing }
Check 'msgsvc GET /message-requests with backend token (A)' ($r.StatusCode -eq 200)

# --- 4. create request A -> B (201) ------------------------------------------
$body = @{ recipient_id = $idB; note = 'Local verification note' } | ConvertTo-Json
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$msg/message-requests" -Headers $hdrA -ContentType 'application/json' -Body $body -UseBasicParsing }
$created = if ($r) { $r.Content | ConvertFrom-Json } else { $null }
Check 'msgsvc POST /message-requests A->B = 201' ($r.StatusCode -eq 201)
$reqId = $created.id
Check 'created row carries id' ($null -ne $reqId)
Check 'created row status=pending' ($created.status -eq 'pending')
Check 'created row note persisted' ($created.note -eq 'Local verification note')

# --- 5. re-send same pair -> 200 with SAME id (dedupe) -----------------------
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$msg/message-requests" -Headers $hdrA -ContentType 'application/json' -Body $body -UseBasicParsing }
$again = if ($r) { $r.Content | ConvertFrom-Json } else { $null }
Check 're-POST same pair = 200' ($r.StatusCode -eq 200)
Check 're-POST returns same id' ($again.id -eq $reqId)


# --- 6. recipient list + count -----------------------------------------------
$pendingB = Invoke-RestMethod -Uri "$msg/message-requests?status=pending" -Headers $hdrB
$cntB = Invoke-RestMethod -Uri "$msg/message-requests/count" -Headers $hdrB
Check 'B pending list contains request' (@($pendingB.items | Where-Object { $_.id -eq $reqId }).Count -eq 1)
Check 'B pending count >= 1 (server-derived)' ($cntB.pending -ge 1)

# --- 7. guard: sender cannot accept own request -> 404 -----------------------
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$msg/message-requests/$reqId/accept" -Headers $hdrA -UseBasicParsing }
Check 'sender accept => 404' ($c -eq 404)

# --- 8. B accepts -> accepted ------------------------------------------------
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$msg/message-requests/$reqId/accept" -Headers $hdrB -UseBasicParsing }
$accepted = if ($r) { $r.Content | ConvertFrom-Json } else { $null }
Check 'B accept = 200 accepted' ($r.StatusCode -eq 200 -and $accepted.status -eq 'accepted')

# --- 9. accept again -> 409 --------------------------------------------------
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$msg/message-requests/$reqId/accept" -Headers $hdrB -UseBasicParsing }
Check 'second accept => 409' ($c -eq 409)

# --- 10. second request B -> A, rejected by A --------------------------------
$body2 = @{ recipient_id = $idA; note = 'reverse request' } | ConvertTo-Json
$rev = Invoke-RestMethod -Method Post -Uri "$msg/message-requests" -Headers $hdrB -ContentType 'application/json' -Body $body2
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$msg/message-requests/$($rev.id)/reject" -Headers $hdrA -UseBasicParsing }
$rej = if ($r) { $r.Content | ConvertFrom-Json } else { $null }
Check 'A reject reverse request = 200 rejected' ($r.StatusCode -eq 200 -and $rej.status -eq 'rejected')

# --- 11. unauthenticated -> 401 ----------------------------------------------
($r, $c) = StatusOf { Invoke-WebRequest -Uri "$msg/message-requests" -UseBasicParsing }
Check 'msgsvc no token => 401' ($c -eq 401)
($r, $c) = StatusOf { Invoke-WebRequest -Uri "$api/auth/me" -UseBasicParsing }
Check 'backend no token => 401' ($c -eq 401)

# --- 12. backend conversation + message round-trip ---------------------------
$conv = Invoke-RestMethod -Method Post -Uri "$api/conversations" -Headers $hdrA -ContentType 'application/json' `
    -Body (@{ user_id = $idB } | ConvertTo-Json)
Check 'backend POST /conversations' ($null -ne $conv.id)
$msgBody = @{ body = 'Local verification message'; client_message_id = "verify-$stamp" } | ConvertTo-Json
$msg1 = Invoke-RestMethod -Method Post -Uri "$api/conversations/$($conv.id)/messages" -Headers $hdrA -ContentType 'application/json' -Body $msgBody
Check 'backend POST message' ($null -ne $msg1.id -and $msg1.body -eq 'Local verification message')
($r, $c) = StatusOf { Invoke-WebRequest -Method Post -Uri "$api/conversations/$($conv.id)/messages" -Headers $hdrA -ContentType 'application/json' -Body $msgBody -UseBasicParsing }
$resend = if ($r) { $r.Content | ConvertFrom-Json } else { $null }
Check 're-send same client_message_id = 200 same id' ($r.StatusCode -eq 200 -and $resend.id -eq $msg1.id)
$msgsB = Invoke-RestMethod -Uri "$api/conversations/$($conv.id)/messages" -Headers $hdrB
Check 'B reads the message' (@($msgsB.items | Where-Object { $_.id -eq $msg1.id }).Count -eq 1)
$convA = Invoke-RestMethod -Uri "$api/conversations" -Headers $hdrA
Check 'A conversation list non-empty' (@($convA.items | Where-Object { $_.id -eq $conv.id }).Count -eq 1)
$convB = Invoke-RestMethod -Uri "$api/conversations" -Headers $hdrB
Check 'B conversation list non-empty' (@($convB.items | Where-Object { $_.id -eq $conv.id }).Count -eq 1)

# --- 13. cross-service identity consistency ----------------------------------
Check 'msgsvc sees backend users (recipient resolved)' ($created.recipient_id.ToString() -eq $idB.ToString())

"`nTOTAL: $script:pass passed, $script:fail failed"
