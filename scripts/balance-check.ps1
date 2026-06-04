# balance-check.ps1
# Single-pass JS/GS lexer: strips line/block comments, '..' ".." `..` strings,
# and /regex/ literals (heuristic), then verifies bracket balance with a stack.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$files = Get-ChildItem -Path $Root -Recurse -Include *.gs,*.js -File |
  Where-Object { $_.FullName -notmatch 'node_modules|dist' }

$bad = 0
foreach ($f in $files) {
  $s = Get-Content -Raw -LiteralPath $f.FullName
  $n = $s.Length
  $i = 0
  $prevSig = ''        # previous significant char (for regex detection)
  $stack = New-Object System.Collections.Generic.Stack[char]
  $ok = $true
  $msg = ''
  $pairs = @{ ')' = '('; ']' = '['; '}' = '{' }

  while ($i -lt $n) {
    $c = $s[$i]
    $nx = if ($i + 1 -lt $n) { $s[$i+1] } else { [char]0 }

    # line comment
    if ($c -eq '/' -and $nx -eq '/') { while ($i -lt $n -and $s[$i] -ne "`n") { $i++ }; continue }
    # block comment
    if ($c -eq '/' -and $nx -eq '*') {
      $i += 2
      while ($i + 1 -lt $n -and -not ($s[$i] -eq '*' -and $s[$i+1] -eq '/')) { $i++ }
      $i += 2; continue
    }
    # strings
    if ($c -eq "'" -or $c -eq '"' -or $c -eq '`') {
      $q = $c; $i++
      while ($i -lt $n) {
        if ($s[$i] -eq '\') { $i += 2; continue }
        if ($s[$i] -eq $q) { $i++; break }
        $i++
      }
      $prevSig = 'x'; continue
    }
    # regex literal: '/' that is not division. Heuristic: previous significant
    # token is an operator/opening bracket/keyword boundary, not value-like.
    if ($c -eq '/' ) {
      $valueLike = ($prevSig -match '[A-Za-z0-9_$\)\]]')
      if (-not $valueLike) {
        $i++
        $inClass = $false
        while ($i -lt $n) {
          $rc = $s[$i]
          if ($rc -eq '\') { $i += 2; continue }
          if ($rc -eq '[') { $inClass = $true }
          elseif ($rc -eq ']') { $inClass = $false }
          elseif ($rc -eq '/' -and -not $inClass) { $i++; break }
          elseif ($rc -eq "`n") { break }   # not a regex after all
          $i++
        }
        $prevSig = 'x'; continue
      }
    }

    if ($c -eq '(' -or $c -eq '[' -or $c -eq '{') { $stack.Push($c) }
    elseif ($pairs.ContainsKey([string]$c)) {
      if ($stack.Count -eq 0 -or $stack.Pop() -ne $pairs[[string]$c]) {
        $ok = $false; $msg = "mismatched '$c' at index $i"; break
      }
    }

    if ($c -notmatch '\s') { $prevSig = $c }
    $i++
  }
  if ($ok -and $stack.Count -ne 0) { $ok = $false; $msg = "unclosed $($stack.Count) bracket(s)" }

  $rel = $f.FullName.Substring($Root.Length+1)
  if ($ok) { "OK    $rel" } else { $bad++; "FAIL  $rel  -> $msg" }
}
""
if ($bad -eq 0) { "ALL $($files.Count) FILES BALANCED" } else { "$bad FILE(S) UNBALANCED" }
