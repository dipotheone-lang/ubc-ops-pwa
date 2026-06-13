# xlsx-to-json.ps1 — reconstruct worksheet rows from a .xlsx into JSON.
# Resolves shared strings and cell references (A1/B2…). First row = headers.
#   powershell -File xlsx-to-json.ps1 -Path file.xlsx [-Sheet "Name"] [-Out out.json] [-MaxRows 1000]
param([Parameter(Mandatory)][string]$Path, [string]$Sheet = '', [string]$Out = '', [int]$MaxRows = 100000)
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-Entry($zip, $name) {
  $e = $zip.Entries | Where-Object { $_.FullName -eq $name }; if (-not $e) { return '' }
  $sr = New-Object System.IO.StreamReader($e.Open()); $t = $sr.ReadToEnd(); $sr.Close(); return $t
}
function Decode($s) { return [System.Net.WebUtility]::HtmlDecode($s) }
function ColLetters([string]$ref) { return ($ref -replace '\d', '') }
function ColIndex([string]$letters) { $n = 0; foreach ($ch in $letters.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }; return $n - 1 }

$zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
try {
  # shared strings
  $ssXml = Read-Entry $zip 'xl/sharedStrings.xml'
  $ss = @()
  if ($ssXml) {
    foreach ($m in [regex]::Matches($ssXml, '<si>(.*?)</si>', 'Singleline')) {
      $txt = ($m.Groups[1].Value -replace '<[^>]+>', ''); $ss += (Decode $txt)
    }
  }
  # locate sheet
  $wb = Read-Entry $zip 'xl/workbook.xml'
  $names = [regex]::Matches($wb, '<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]*)"') | ForEach-Object { $_.Groups[1].Value }
  $sheetPath = 'xl/worksheets/sheet1.xml'
  if ($Sheet) {
    $idx = ([System.Collections.Generic.List[string]]$names).IndexOf($Sheet)
    if ($idx -ge 0) { $sheetPath = "xl/worksheets/sheet$($idx + 1).xml" }
  }
  $sheetXml = Read-Entry $zip $sheetPath
  if (-not $sheetXml) { $sheetXml = Read-Entry $zip 'xl/worksheets/sheet1.xml' }

  $rows = @()
  $rowMatches = [regex]::Matches($sheetXml, '<row[^>]*>(.*?)</row>', 'Singleline')
  foreach ($rm in $rowMatches) {
    if ($rows.Count -ge $MaxRows) { break }
    $cells = @{}
    foreach ($cm in [regex]::Matches($rm.Groups[1].Value, '<c r="([A-Z]+)\d+"([^>]*)>(.*?)</c>', 'Singleline')) {
      $col = ColIndex (ColLetters $cm.Groups[1].Value)
      $attrs = $cm.Groups[2].Value; $inner = $cm.Groups[3].Value
      $val = ''
      $vM = [regex]::Match($inner, '<v>(.*?)</v>', 'Singleline')
      if ($attrs -match 't="s"' -and $vM.Success) { $i = [int]$vM.Groups[1].Value; if ($i -lt $ss.Count) { $val = $ss[$i] } }
      elseif ($attrs -match 't="inlineStr"') { $tM = [regex]::Match($inner, '<t[^>]*>(.*?)</t>', 'Singleline'); if ($tM.Success) { $val = Decode $tM.Groups[1].Value } }
      elseif ($vM.Success) { $val = Decode $vM.Groups[1].Value }
      $cells[$col] = $val
    }
    $rows += , $cells
  }
  # build objects using row 0 as headers
  if ($rows.Count -lt 1) { '[]'; return }
  $maxCol = 0; foreach ($r in $rows) { foreach ($k in $r.Keys) { if ($k -gt $maxCol) { $maxCol = $k } } }
  $headers = @(); for ($c = 0; $c -le $maxCol; $c++) { $h = if ($rows[0].ContainsKey($c)) { $rows[0][$c] } else { '' }; $headers += ("$h").Trim() }
  $result = @()
  for ($i = 1; $i -lt $rows.Count; $i++) {
    $obj = [ordered]@{}; $any = $false
    for ($c = 0; $c -le $maxCol; $c++) {
      $key = if ($headers[$c]) { $headers[$c] } else { "col$c" }
      $v = if ($rows[$i].ContainsKey($c)) { $rows[$i][$c] } else { '' }
      if ($v -ne '') { $any = $true }
      $obj[$key] = $v
    }
    if ($any) { $result += [pscustomobject]$obj }
  }
  $json = $result | ConvertTo-Json -Depth 4
  if ($Out) { [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding $false)); "Wrote $($result.Count) rows to $Out. Sheets: $($names -join ', ')" }
  else { $json }
}
finally { $zip.Dispose() }
