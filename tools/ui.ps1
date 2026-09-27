# Helper: drive the MahaJob app on the running emulator.
# Usage: pwsh -File c:\mahaa\tools\ui.ps1 -Action <action> [-Arg <text>] [-X n] [-Y n] [-Index n] [-Out <file>]
#
#   dump      full hierarchy, with each node's class, label and bounds
#   dumptext  just the visible labels, in reading order
#   find      centre coordinates of every node whose label contains -Arg
#   taptext   tap the node whose label contains -Arg (-Index picks among repeats)
#   fill      clear the -Index'th input field top-down and type -Arg into it
#   tap/text/back/esc/swipe/scrollup   raw input
#   shot      verified binary-safe PNG capture
#   logs/clearlogs
#
# Prefer taptext/fill over hard-coded coordinates: a StatusBanner appearing or a
# ScrollView settling moves every pixel below it, and a tap that lands one row
# off silently hits the wrong control.
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$Arg = '',
  [int]$X = 0,
  [int]$Y = 0,
  # taptext: which match to use when a label appears more than once (0 = first).
  [int]$Index = 0,
  [string]$Out = 'c:\mahaa\_out'
)

$env:PATH = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:PATH"

switch ($Action) {
  'dump' {
    $remote = '/sdcard/_ui.xml'
    adb shell uiautomator dump $remote | Out-Null
    adb pull $remote $Out | Out-Null
    $raw = Get-Content $Out -Raw
    foreach ($n in [regex]::Matches($raw, '<node[^>]*>')) {
      $t = [regex]::Match($n.Value, 'text="([^"]*)"').Groups[1].Value
      $d = [regex]::Match($n.Value, 'content-desc="([^"]*)"').Groups[1].Value
      $b = [regex]::Match($n.Value, 'bounds="([^"]*)"').Groups[1].Value
      $c = [regex]::Match($n.Value, 'class="([^"]*)"').Groups[1].Value
      $label = if ($t) { $t } else { $d }
      if ($label) { "{0,-14} {1,-46} {2}" -f $c.Split('.')[-1], $label, $b }
    }
  }
  'find' {
    $raw = Get-Content $Out -Raw
    foreach ($n in [regex]::Matches($raw, '<node[^>]*>')) {
      $t = [regex]::Match($n.Value, 'text="([^"]*)"').Groups[1].Value
      $d = [regex]::Match($n.Value, 'content-desc="([^"]*)"').Groups[1].Value
      $label = if ($t) { $t } else { $d }
      if ($label -like "*$Arg*") {
        $b = [regex]::Match($n.Value, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
        # Explicit [int] casts, not Group.ValueAsInt: under Windows PowerShell 5.1
        # the property resolves to $null on a Capture, which silently produced
        # centre=0,0 and made every coordinate-based tap land at the screen corner.
        $cx = [int](([int]$b.Groups[1].Value + [int]$b.Groups[3].Value) / 2)
        $cy = [int](([int]$b.Groups[2].Value + [int]$b.Groups[4].Value) / 2)
        "MATCH '$label' center=$cx,$cy bounds=$($b.Value)"
      }
    }
  }
  'tap'   { adb shell input tap $X $Y }
  'text'  { adb shell input text $Arg }
  'back'  { adb shell input keyevent 4 }
  'esc'   { adb shell input keyevent 111 }
  'swipe' {
    # Scroll the content down one viewport (finger travels up the screen).
    $x = if ($X) { $X } else { 540 }
    $y2 = if ($Y) { $Y } else { 600 }
    adb shell input swipe $x 1800 $x $y2 300
  }
  'scrollup' {
    # Scroll the content back up (finger travels down the screen).
    $x = if ($X) { $X } else { 540 }
    $y2 = if ($Y) { $Y } else { 1800 }
    adb shell input swipe $x 600 $x $y2 300
  }
  'dumptext' {
    # Just the visible labels, one per line, in reading order - the form of the
    # hierarchy that is actually useful when asserting what a screen rendered.
    $remote = '/sdcard/_ui.xml'
    adb shell uiautomator dump $remote | Out-Null
    $tmp = [System.IO.Path]::GetTempFileName()
    adb pull $remote $tmp | Out-Null
    $raw = Get-Content $tmp -Raw
    Remove-Item $tmp -Force
    $seen = @{}
    foreach ($n in [regex]::Matches($raw, '<node[^>]*>')) {
      $t = [regex]::Match($n.Value, 'text="([^"]*)"').Groups[1].Value
      $d = [regex]::Match($n.Value, 'content-desc="([^"]*)"').Groups[1].Value
      $label = if ($t) { $t } else { $d }
      if ($label -and -not $seen.ContainsKey($label)) { $seen[$label] = $true; $label }
    }
  }
  'taptext' {
    # Tap a node by its label, not by a hard-coded pixel. Coordinates go stale the
    # moment a StatusBanner appears or a ScrollView settles, and a tap that lands
    # one row off silently hits the wrong control - which is how a "Back returns
    # to Profile" test can appear to pass while actually testing nothing.
    $remote = '/sdcard/_ui.xml'
    adb shell uiautomator dump $remote | Out-Null
    $tmp = [System.IO.Path]::GetTempFileName()
    adb pull $remote $tmp | Out-Null
    $raw = Get-Content $tmp -Raw
    Remove-Item $tmp -Force

    $exact = @()
    $partial = @()
    foreach ($n in [regex]::Matches($raw, '<node[^>]*>')) {
      $t = [regex]::Match($n.Value, 'text="([^"]*)"').Groups[1].Value
      $d = [regex]::Match($n.Value, 'content-desc="([^"]*)"').Groups[1].Value
      $label = if ($t) { $t } else { $d }
      if (-not $label) { continue }
      $isMatch = $false
      if ($label -eq $Arg) { $isMatch = $true } elseif ($label -like "*$Arg*") { $isMatch = $true }
      if (-not $isMatch) { continue }
      $b = [regex]::Match($n.Value, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
      if (-not $b.Success) { continue }
      $hit = [pscustomobject]@{
        Label  = $label
        Exact  = ($label -eq $Arg)
        X      = [int](([int]$b.Groups[1].Value + [int]$b.Groups[3].Value) / 2)
        Y      = [int](([int]$b.Groups[2].Value + [int]$b.Groups[4].Value) / 2)
        Bounds = $b.Value
      }
      if ($hit.Exact) { $exact += $hit } else { $partial += $hit }
    }
    # An exact label always wins over a substring one, so -Arg 'Profile' hits the
    # Profile tab rather than "Continue profile" further up the screen.
    $hits = if ($exact.Count -gt 0) { $exact } else { $partial }
    if ($hits.Count -eq 0) { throw "taptext: no visible node matching '$Arg'" }
    $hit = if ($Index -ge 0 -and $Index -lt $hits.Count) { $hits[$Index] } else { $hits[0] }
    adb shell input tap $hit.X $hit.Y
    "TAPPED '$($hit.Label)' at $($hit.X),$($hit.Y) $($hit.Bounds)  (exact=$($exact.Count) partial=$($partial.Count), used #$Index)"
  }
  'fill' {
    # Tap a labelled field and type into it, so text entry does not depend on a
    # remembered pixel either. Clears the field first (MOVE_END + DEL) so a
    # retried value cannot concatenate onto the previous one.
    $remote = '/sdcard/_ui.xml'
    adb shell uiautomator dump $remote | Out-Null
    $tmp = [System.IO.Path]::GetTempFileName()
    adb pull $remote $tmp | Out-Null
    $raw = Get-Content $tmp -Raw
    Remove-Item $tmp -Force

    $fields = @()
    foreach ($n in [regex]::Matches($raw, '<node[^>]*class="android.widget.EditText"[^>]*>')) {
      $b = [regex]::Match($n.Value, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
      if (-not $b.Success) { continue }
      $fields += [pscustomobject]@{
        Top    = [int]$b.Groups[2].Value
        Text   = [regex]::Match($n.Value, 'text="([^"]*)"').Groups[1].Value
        X      = [int](([int]$b.Groups[1].Value + [int]$b.Groups[3].Value) / 2)
        Y      = [int](([int]$b.Groups[2].Value + [int]$b.Groups[4].Value) / 2)
        Bounds = $b.Value
      }
    }
    if ($fields.Count -eq 0) { throw "fill: no input field on screen" }
    # -Index picks the field top-down, so a two-field form is addressable by
    # position (0 = first) instead of by a pixel that shifts per screen.
    $ordered = @($fields | Sort-Object Top)
    if ($Index -ge $ordered.Count) { throw "fill: only $($ordered.Count) field(s) on screen, cannot use -Index $Index" }
    $target = $ordered[$Index]
    adb shell input tap $target.X $target.Y
    Start-Sleep -Milliseconds 700
    adb shell input keyevent 123
    1..40 | ForEach-Object { adb shell input keyevent 67 | Out-Null }
    if ($Arg) { adb shell input text $Arg }
    "FILLED field #$Index (was '$($target.Text)') at $($target.X),$($target.Y) $($target.Bounds) with '$Arg'"
  }
  'shot'  {
    # Binary-safe screenshot capture.
    # NEVER use `adb exec-out screencap -p > file.png` from Windows PowerShell 5.1:
    # the native stdout stream is decoded with the console code page and re-encoded
    # as UTF-16LE, so the file lands ~2x too big, starting with FF FE instead of the
    # PNG signature, and no image library can open it (Pillow: "cannot identify
    # image file <_io.BytesIO object>").
    # Instead: screenshot on the device, then `adb pull` (byte-exact), then verify.
    $remote = '/sdcard/_mj_shot.png'
    $local = if ($Arg) { $Arg } else { 'c:\mahaa\_shot.png' }
    $part = "$local.part"

    # 1) capture on the device
    adb shell screencap -p $remote
    if ($LASTEXITCODE -ne 0) { throw "screencap failed on the device (adb exit $LASTEXITCODE)" }

    # 2) pull the image (binary-safe transport)
    adb pull $remote $part
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $part)) { throw "adb pull failed - no screenshot at $part" }

    # 3) verify the PNG signature is 89504e470d0a1a0a
    $bytes = [System.IO.File]::ReadAllBytes($part)
    if ($bytes.Length -lt 8) { throw "capture is only $($bytes.Length) bytes ($part) - not an image" }
    $sig = ($bytes[0..7] | ForEach-Object { $_.ToString('x2') }) -join ''
    if ($sig -ne '89504e470d0a1a0a') {
      throw "capture is NOT a PNG (signature '$sig', kept for inspection at $part). DO NOT attach it. Check for PowerShell '>' redirection of a native command."
    }

    # 4) verify the image can actually be opened, and report its size
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    $img = $null
    try { $img = [System.Drawing.Image]::FromFile($part) }
    catch { throw "capture has a valid PNG signature but cannot be opened: $($_.Exception.Message) ($part)" }
    $w = $img.Width
    $h = $img.Height
    $fmt = $img.RawFormat.ToString()
    $img.Dispose()

    # 5) only now publish it over the requested path, so a bad capture never replaces a good one
    Move-Item -Path $part -Destination $local -Force
    "{0}  {1} bytes  {2}x{3}  {4}  signature={5}  (safe to attach)" -f $local, $bytes.Length, $w, $h, $fmt, $sig
  }
  'logs'  {
    $n = if ($Arg) { $Arg } else { '300' }
    adb logcat -d -t $n 2>&1 |
      Select-String -Pattern 'ReactNativeJS|FATAL|AndroidRuntime|Error|Exception' |
      Select-Object -Last 40
  }
  'clearlogs' { adb logcat -c }
}
