param([string]$OutDir, [string]$Only = '')
# Writes the Excel fixtures of tests/fixtures/import with Microsoft Excel itself (COM automation), so the
# importer is tested on files a real Excel saved. Every value is synthetic.
# -Only 'a.xlsx,b.xls' regenerates just those files (Excel writes timestamps: the others would change too).
$ErrorActionPreference = 'Stop'
$OutDir = (Resolve-Path $OutDir).Path
$want = @(if ($Only) { $Only -split ',' | ForEach-Object { $_.Trim() } })
function Want([string]$name) { return $want.Count -eq 0 -or $want -contains $name }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.ScreenUpdating = $false
# Excel stamps the Office user name into every file it saves (the author fields, the WRITEACCESS record of
# .xls). A placeholder is used while the fixtures are written; the user's own name is put back at the end.
$savedUserName = $xl.UserName
$xl.UserName = 'fixture'
function A1([int]$r, [int]$c) {
  $s = ''
  while ($c -gt 0) { $m = ($c - 1) % 26; $s = [string][char](65 + $m) + $s; $c = [math]::Floor(($c - 1) / 26) }
  return $s + [string]$r
}
function SetV($ws, [int]$r, [int]$c, $v) {
  $rg = $ws.Range((A1 $r $c))
  if ($v -is [string]) { $rg.Value2 = [string]$v } else { $rg.Value2 = [double]$v }
}
function SetF($ws, [int]$r, [int]$c, [string]$f) { $ws.Range((A1 $r $c)).Formula = $f }
# Excel still saves the folder of the workbook (x15ac:absPath in xl/workbook.xml) and may keep author
# fields in docProps/core.xml: both are removed from the zip after saving.
function Scrub-Xlsx([string]$path) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $zip = [System.IO.Compression.ZipFile]::Open($path, [System.IO.Compression.ZipArchiveMode]::Update)
  try {
    foreach ($part in @('xl/workbook.xml', 'docProps/core.xml')) {
      $entry = $zip.GetEntry($part)
      if ($null -eq $entry) { continue }
      $stream = $entry.Open()
      try {
        $reader = New-Object System.IO.StreamReader($stream, $utf8, $true, 4096, $true)
        $xml = $reader.ReadToEnd()
        $reader.Dispose()
        $clean = $xml -replace '<mc:AlternateContent [^>]*><mc:Choice Requires="x15"><x15ac:absPath [^>]*/></mc:Choice></mc:AlternateContent>', ''
        $clean = $clean -replace '<x15ac:absPath [^>]*/>', ''
        $clean = $clean -replace '<dc:creator>[^<]*</dc:creator>', '<dc:creator></dc:creator>'
        $clean = $clean -replace '<cp:lastModifiedBy>[^<]*</cp:lastModifiedBy>', '<cp:lastModifiedBy></cp:lastModifiedBy>'
        if ($clean -ne $xml) {
          $bytes = $utf8.GetBytes($clean)
          $stream.SetLength(0)
          $stream.Write($bytes, 0, $bytes.Length)
        }
      }
      finally { $stream.Dispose() }
    }
  }
  finally { $zip.Dispose() }
}
function Save($wb, $name, [int]$format = 51) {
  $p = Join-Path $OutDir $name
  if (Test-Path $p) { Remove-Item $p -Force }
  # Leaves the author and last-modified-by fields out of the saved file.
  $wb.RemovePersonalInformation = $true
  $wb.SaveAs($p, $format)
  $wb.Close($false)
  if ($format -eq 51) { Scrub-Xlsx $p }
}
function Sheets($wb, [int]$n) {
  while ($wb.Worksheets.Count -lt $n) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
}
try {
 if (Want 'excel-saved.xlsx') {
  # 1. excel-saved.xlsx: a text-only first sheet, then the data sheet
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 2) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  $notes = $wb.Worksheets.Item(1); $notes.Name = 'Notes'
  SetV $notes (1) (1) ('Lab notebook')
  SetV $notes (2) (1) ('Measured on bench 3')
  $ws = $wb.Worksheets.Item(2); $ws.Name = 'Measurements'
  $hdr = @('Time (s)','Voltage (V)','Efficiency','Date','Status','Double')
  for ($c = 0; $c -lt $hdr.Count; $c++) { SetV $ws 1 ($c + 1) $hdr[$c] }
  $times = @(0, 0.5, 1, 1.5)
  $volts = @(1.23456789012345, -0.003, 0.000015, 0.1)
  $eff = @(0.12, 0.075, 1, 0.005)
  $status = @('ok', 'NA', '', 'repeat')
  for ($r = 0; $r -lt 4; $r++) {
    SetV $ws ($r + 2) (1) ($times[$r])
    SetV $ws ($r + 2) (2) ($volts[$r])
    SetV $ws ($r + 2) (3) ($eff[$r])
    SetF $ws ($r + 2) (4) ("=DATE(2024,3,$(15 + $r))")
    if ($status[$r] -ne '') { SetV $ws ($r + 2) 5 $status[$r] }
  }
  $ws.Range('B2:B5').NumberFormat = '0.00'
  $ws.Range('C2:C5').NumberFormat = '0%'
  $ws.Range('D2:D5').NumberFormat = 'yyyy-mm-dd'
  $ws.Range('F2').Formula = '=1/0'
  $ws.Range('F3').Formula = '=A3*2'
  $ws.Range('F4').Formula = '=B4*2'
  $ws.Range('F5').Formula = '=NA()'
  Save $wb 'excel-saved.xlsx'
 }

 if (Want 'date1904.xlsx') {
  # 2. date1904.xlsx: the 1904 date system
  $wb = $xl.Workbooks.Add()
  $wb.Date1904 = $true
  $ws = $wb.Worksheets.Item(1); $ws.Name = 'Dates'
  SetV $ws (1) (1) ('Date')
  SetV $ws (1) (2) ('Value')
  for ($r = 0; $r -lt 3; $r++) {
    SetF $ws ($r + 2) (1) ("=DATE(2024,3,$(15 + $r))+TIME(12,30,0)")
    SetV $ws ($r + 2) (2) (10 * ($r + 1))
  }
  $ws.Range('A2:A4').NumberFormat = 'yyyy-mm-dd hh:mm'
  Save $wb 'date1904.xlsx'
 }

 if (Want 'merged-header.xlsx') {
  # 3. merged-header.xlsx: a merged group header and one merge in the data area
  $wb = $xl.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1); $ws.Name = 'Sheet1'
  SetV $ws (1) (1) ('Temperature')
  $ws.Range('A1:B1').Merge()
  SetV $ws (1) (3) ('Pressure')
  SetV $ws (2) (1) ('T1 (°C)')
  SetV $ws (2) (2) ('T2 (°C)')
  SetV $ws (2) (3) ('p (kPa)')
  $data = @(@(20.5, 21.0, 101.3), @(22.1, 22.4, 101.1), @(23.7, 23.9, 100.9), @(25.2, 25.0, 100.7))
  for ($r = 0; $r -lt 4; $r++) { for ($c = 0; $c -lt 3; $c++) { SetV $ws ($r + 3) ($c + 1) $data[$r][$c] } }
  $ws.Range('C5:C6').Merge()
  Save $wb 'merged-header.xlsx'
 }

 if (Want 'data-from-A3.xlsx') {
  # 4. data-from-A3.xlsx: the table starts at row 3
  $wb = $xl.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1); $ws.Name = 'Sheet1'
  SetV $ws (3) (1) ('I (A)')
  SetV $ws (3) (2) ('V (V)')
  $iv = @(@(0.01, 0.464), @(0.02, 0.941), @(0.03, 1.402))
  for ($r = 0; $r -lt 3; $r++) { SetV $ws ($r + 4) 1 $iv[$r][0]; SetV $ws ($r + 4) 2 $iv[$r][1] }
  Save $wb 'data-from-A3.xlsx'
 }

 if (Want 'micro-tables.xlsx') {
  # 5. micro-tables.xlsx: several small tables per sheet, in the layouts lab workbooks often use.
  $wb = $xl.Workbooks.Add()
  Sheets $wb 4
  # Sheet 1: a 2 x 3 grid of titled tables (B2, G2, L2 / B11, G11, L11), one blank row and column apart:
  # a title "oak | plank 1", the header "position | Width mm | Depth mm | area", six rows, area a formula.
  $ws = $wb.Worksheets.Item(1); $ws.Name = 'Grid'
  $woods = @('oak', 'pine', 'birch')
  for ($i = 0; $i -lt 2; $i++) {
    for ($j = 0; $j -lt 3; $j++) {
      $r = 2 + 9 * $i
      $c = 2 + 5 * $j
      SetV $ws $r $c $woods[$j]
      SetV $ws $r ($c + 1) ("plank $($i + 1)")
      # Headers typed by hand vary in case and trailing spaces: "position " and "Area" still match the others.
      SetV $ws ($r + 1) $c $(if ($i -eq 0 -and $j -eq 1) { 'position ' } else { 'position' })
      SetV $ws ($r + 1) ($c + 1) 'Width mm'
      SetV $ws ($r + 1) ($c + 2) 'Depth mm'
      SetV $ws ($r + 1) ($c + 3) $(if ($i -eq 1 -and $j -eq 2) { 'Area' } else { 'area' })
      for ($k = 0; $k -lt 6; $k++) {
        $rr = $r + 2 + $k
        SetV $ws $rr $c (5 * ($k + 1))
        SetV $ws $rr ($c + 1) ([math]::Round((48 - 2 * $k) * (1 - 0.1 * $j) + 2 * $i, 2))
        SetV $ws $rr ($c + 2) (20 + 2 * $k + 3 * $i - 2 * $j)
        SetF $ws $rr ($c + 3) ("=ROUND($(A1 $rr ($c + 1))*$(A1 $rr ($c + 2)),2)")
      }
    }
  }
  # Sheet 2: transposed tables (variables in rows) stacked vertically, each under a "layers | n" line.
  $ws = $wb.Worksheets.Item(2); $ws.Name = 'Transposed'
  $layers = @(0, 2, 4)
  for ($b = 0; $b -lt 3; $b++) {
    $r = 2 + 6 * $b
    SetV $ws $r 2 'layers'
    SetV $ws $r 3 $layers[$b]
    SetV $ws ($r + 1) 2 'duty'
    SetV $ws ($r + 2) 2 'input'
    SetV $ws ($r + 3) 2 'rise'
    SetV $ws ($r + 4) 2 'loss'
    for ($k = 0; $k -lt 4; $k++) {
      SetV $ws ($r + 1) (3 + $k) (0.25 * ($k + 1))
      SetV $ws ($r + 2) (3 + $k) (5 * ($k + 1))
      SetV $ws ($r + 3) (3 + $k) ([math]::Round(0.3 + 0.45 * $k - 0.02 * $b, 2))
      SetV $ws ($r + 4) (3 + $k) ([math]::Round(($k + 1) * ($k + 1) * (4 - 0.5 * $b) - $b - 1.5, 1))
    }
    $ws.Range("$(A1 ($r + 1) 3):$(A1 ($r + 1) 6)").NumberFormat = '0%'
  }
  # A remark typed right after the last value of a row (part of the same island of cells).
  SetV $ws 6 7 'drift +0.4'
  # Sheet 3: two side-by-side tables (A1, H1) under key/value lines with merged cells; the "h - h0"
  # column is merged over C:D in every row, so column D is empty inside the table.
  $ws = $wb.Worksheets.Item(3); $ws.Name = 'Paired'
  $probes = @('in', 'out', 1, 3, 5, 'ref', 2)
  $h = @(@(182, 171, 158, 146, 139, 150, 163), @(176, 168, 160, 152, 144, 150, 156))
  $tilts = @(-5, 0)
  for ($t = 0; $t -lt 2; $t++) {
    $c = 1 + 7 * $t
    $col = @(for ($k = 0; $k -lt 6; $k++) { (A1 1 ($c + $k)).TrimEnd('1') })
    SetV $ws 1 $c 'Tilt'
    $ws.Range("$($col[0])1:$($col[2])1").Merge()
    SetV $ws 1 ($c + 3) $tilts[$t]
    $ws.Range("$($col[3])1:$($col[5])1").Merge()
    SetV $ws 2 $c 'Fluid density (kg/m3)'
    $ws.Range("$($col[0])2:$($col[2])2").Merge()
    SetV $ws 2 ($c + 3) 998.2
    $ws.Range("$($col[3])2:$($col[5])2").Merge()
    SetV $ws 3 $c 'Probe'
    SetV $ws 3 ($c + 1) 'h [mm]'
    SetV $ws 3 ($c + 2) 'h - h0 [mm]'
    SetV $ws 3 ($c + 4) 'dp [Pa]'
    SetV $ws 3 ($c + 5) 'p [Pa]'
    for ($k = 0; $k -lt 7; $k++) {
      $r = 4 + $k
      SetV $ws $r $c $probes[$k]
      SetV $ws $r ($c + 1) $h[$t][$k]
      SetF $ws $r ($c + 2) ("=$($col[1])$r-150")
      SetF $ws $r ($c + 4) ("=ROUND($($col[2])$r*9.79,1)")
      SetF $ws $r ($c + 5) ("=$($col[4])$r+101325")
    }
    for ($r = 3; $r -le 10; $r++) { $ws.Range("$($col[2])$($r):$($col[3])$r").Merge() }
  }
  # Sheet 4: a 2-D matrix (position down, time across) under a two-cell title.
  $ws = $wb.Worksheets.Item(4); $ws.Name = 'Matrix'
  SetV $ws 2 2 'Rod temperature (°C)'
  SetV $ws 2 4 'time (min)'
  SetV $ws 3 2 'position (cm)'
  for ($k = 0; $k -lt 6; $k++) { SetV $ws 3 (3 + $k) $k }
  for ($i = 0; $i -lt 6; $i++) {
    $x = 5 * ($i + 1)
    SetV $ws (4 + $i) 2 $x
    for ($k = 0; $k -lt 6; $k++) { SetV $ws (4 + $i) (3 + $k) ([math]::Round(20 + 70 * [math]::Exp(-$x / 25) * (1 - 0.12 * $k))) }
  }
  $wb.Worksheets.Item(1).Activate()
  Save $wb 'micro-tables.xlsx'
 }

 if (Want 'biff8-tables.xls') {
  # 6. biff8-tables.xls: an Excel 97-2003 workbook (FileFormat 56) with two side-by-side tables,
  # merged headers, a merged data cell, accented / Greek / micro text, a date and a percent column.
  $wb = $xl.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1); $ws.Name = 'Misure'
  $mu = [string][char]0x00B5
  $ohm = [string][char]0x03A9
  $egrave = [string][char]0x00E8
  $hdr = @('Tempo (s)', "Tensione ($($mu)V)", "Resistenza ($ohm)", 'Data', 'Efficienza', 'Nota')
  for ($c = 0; $c -lt $hdr.Count; $c++) { SetV $ws 1 ($c + 1) $hdr[$c] }
  $times = @(0, 0.5, 1, 1.5)
  $volts = @(1.25, 2.5, 3.75, 5)
  $res = @(100.5, 101, 101.5, 102)
  $eff = @(0.12, 0.075, 1, 0.005)
  $notes = @("$egrave ok", "$($mu)-test", '', "$ohm alto")
  for ($r = 0; $r -lt 4; $r++) {
    SetV $ws ($r + 2) 1 $times[$r]
    SetV $ws ($r + 2) 2 $volts[$r]
    SetV $ws ($r + 2) 3 $res[$r]
    SetF $ws ($r + 2) 4 ("=DATE(2024,3,$(15 + $r))")
    SetV $ws ($r + 2) 5 $eff[$r]
    if ($notes[$r] -ne '') { SetV $ws ($r + 2) 6 $notes[$r] }
  }
  $ws.Range('D2:D5').NumberFormat = 'yyyy-mm-dd'
  $ws.Range('E2:E5').NumberFormat = '0.0%'
  SetV $ws 1 8 "Pressione $egrave"
  $ws.Range('H1:I1').Merge()
  SetV $ws 2 8 'p1 (kPa)'
  SetV $ws 2 9 'p2 (kPa)'
  $p = @(@(101.3, 99.8), @(101.1, 99.5), @(100.9, 99.1), @(100.7, $null))
  for ($r = 0; $r -lt 4; $r++) {
    SetV $ws ($r + 3) 8 $p[$r][0]
    if ($null -ne $p[$r][1]) { SetV $ws ($r + 3) 9 $p[$r][1] }
  }
  $ws.Range('I5:I6').Merge()
  Save $wb 'biff8-tables.xls' 56
 }

 if (Want 'excel95-cp1252.xls') {
  # 7. excel95-cp1252.xls: Excel 5.0/95 (BIFF5, FileFormat 39) stores 8-bit text in the system code page
  # (here Windows-1252): the euro sign, the en dash and the ellipsis are bytes 0x80, 0x96, 0x85.
  $wb = $xl.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1); $ws.Name = 'Costi'
  SetV $ws 1 1 ('Prezzo (' + [char]0x20AC + ')')
  SetV $ws 1 2 'Nota'
  SetV $ws 2 1 12.5
  SetV $ws 2 2 ('intervallo ' + [char]0x2013 + ' 5')
  SetV $ws 3 1 13
  SetV $ws 3 2 ('ok' + [char]0x2026)
  Save $wb 'excel95-cp1252.xls' 39
 }
}
finally {
  $xl.UserName = $savedUserName
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
'done'
