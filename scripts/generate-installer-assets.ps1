param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\build')
)

Add-Type -AssemblyName System.Drawing

$output = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($output) | Out-Null

$teal = [System.Drawing.ColorTranslator]::FromHtml('#0C7469')
$tealDark = [System.Drawing.ColorTranslator]::FromHtml('#07564F')
$tealDeep = [System.Drawing.ColorTranslator]::FromHtml('#063F3B')
$mint = [System.Drawing.ColorTranslator]::FromHtml('#DDF1ED')
$mintMuted = [System.Drawing.ColorTranslator]::FromHtml('#8EC9C0')
$amber = [System.Drawing.ColorTranslator]::FromHtml('#E0A33A')
$white = [System.Drawing.ColorTranslator]::FromHtml('#FFFFFF')
$paper = [System.Drawing.ColorTranslator]::FromHtml('#F7FAF9')
$line = [System.Drawing.ColorTranslator]::FromHtml('#B9D7D2')

function New-RoundedPath([single]$x, [single]$y, [single]$width, [single]$height, [single]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc([System.Drawing.RectangleF]::new($x, $y, $diameter, $diameter), 180, 90)
  $path.AddArc([System.Drawing.RectangleF]::new($x + $width - $diameter, $y, $diameter, $diameter), 270, 90)
  $path.AddArc([System.Drawing.RectangleF]::new($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter), 0, 90)
  $path.AddArc([System.Drawing.RectangleF]::new($x, $y + $height - $diameter, $diameter, $diameter), 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-RoundedRectangle($graphics, $brush, [single]$x, [single]$y, [single]$width, [single]$height, [single]$radius) {
  $path = New-RoundedPath $x $y $width $height $radius
  $graphics.FillPath($brush, $path)
  $path.Dispose()
}

function Draw-RepairGlyph($graphics, [single]$x, [single]$y, [single]$size, $color, $accentColor) {
  $stroke = [Math]::Max(2, $size * 0.065)
  $pen = [System.Drawing.Pen]::new($color, $stroke)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $videoX = $x + $size * 0.13
  $videoY = $y + $size * 0.18
  $videoW = $size * 0.57
  $videoH = $size * 0.46
  $graphics.DrawRectangle($pen, $videoX, $videoY, $videoW, $videoH)
  $graphics.DrawLine($pen, $videoX + $size * 0.12, $videoY + $size * 0.11, $videoX + $size * 0.12, $videoY + $videoH - $size * 0.11)

  $wrenchPen = [System.Drawing.Pen]::new($color, $stroke * 1.15)
  $wrenchPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $wrenchPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($wrenchPen, $x + $size * 0.47, $y + $size * 0.77, $x + $size * 0.79, $y + $size * 0.42)
  $graphics.DrawLine($wrenchPen, $x + $size * 0.75, $y + $size * 0.37, $x + $size * 0.87, $y + $size * 0.31)
  $graphics.DrawLine($wrenchPen, $x + $size * 0.79, $y + $size * 0.42, $x + $size * 0.89, $y + $size * 0.47)
  $accentBrush = [System.Drawing.SolidBrush]::new($accentColor)
  $graphics.FillEllipse($accentBrush, $x + $size * 0.75, $y + $size * 0.10, $size * 0.14, $size * 0.14)

  $accentBrush.Dispose()
  $wrenchPen.Dispose()
  $pen.Dispose()
}

function New-Canvas([int]$width, [int]$height, $pixelFormat) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, $pixelFormat)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

# Assisted installer welcome/finish sidebar: NSIS requires exactly 164 x 314.
$sidebarCanvas = New-Canvas 164 314 ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$sidebar = $sidebarCanvas.Bitmap
$g = $sidebarCanvas.Graphics
$g.Clear($tealDark)
$g.FillRectangle([System.Drawing.SolidBrush]::new($teal), 0, 0, 164, 214)
$g.FillRectangle([System.Drawing.SolidBrush]::new($tealDeep), 0, 214, 164, 100)

$markBrush = [System.Drawing.SolidBrush]::new($paper)
Fill-RoundedRectangle $g $markBrush 22 24 58 58 12
Draw-RepairGlyph $g 30 32 42 $teal $amber

$connectorPen = [System.Drawing.Pen]::new($mintMuted, 2)
$connectorPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dot
$g.DrawLine($connectorPen, 38, 118, 38, 196)
$nodeBrush = [System.Drawing.SolidBrush]::new($mint)
$activeBrush = [System.Drawing.SolidBrush]::new($amber)
foreach ($point in @(@{Y=116; Active=$true}, @{Y=155; Active=$false}, @{Y=194; Active=$false})) {
  $brush = if ($point.Active) { $activeBrush } else { $nodeBrush }
  $g.FillEllipse($brush, 32, $point.Y, 12, 12)
  $g.FillRectangle([System.Drawing.SolidBrush]::new($line), 56, $point.Y + 3, 63, 3)
  $g.FillRectangle([System.Drawing.SolidBrush]::new($mintMuted), 56, $point.Y + 10, 39, 2)
}

$filmPen = [System.Drawing.Pen]::new($mintMuted, 2)
$g.DrawRectangle($filmPen, 24, 244, 116, 44)
for ($i = 0; $i -lt 5; $i++) {
  $g.FillRectangle($nodeBrush, 30 + $i * 23, 249, 8, 4)
  $g.FillRectangle($nodeBrush, 30 + $i * 23, 279, 8, 4)
}
$g.DrawLine($connectorPen, 52, 266, 112, 266)

$sidebar.Save((Join-Path $output 'installerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$sidebar.Save((Join-Path $output 'uninstallerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$connectorPen.Dispose(); $filmPen.Dispose(); $nodeBrush.Dispose(); $activeBrush.Dispose(); $markBrush.Dispose()
$g.Dispose(); $sidebar.Dispose()

# Header image: 150 x 57, white background blends with the MUI header.
$headerCanvas = New-Canvas 150 57 ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$header = $headerCanvas.Bitmap
$g = $headerCanvas.Graphics
$g.Clear($white)
$g.FillRectangle([System.Drawing.SolidBrush]::new($mint), 73, 0, 15, 57)
$g.FillRectangle([System.Drawing.SolidBrush]::new($amber), 88, 0, 5, 57)
$g.FillRectangle([System.Drawing.SolidBrush]::new($teal), 93, 0, 57, 57)
Draw-RepairGlyph $g 103 8 40 $white $amber
$header.Save((Join-Path $output 'installerHeader.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $header.Dispose()

# Installer/application icon and a PNG preview used for visual verification.
$iconCanvas = New-Canvas 256 256 ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$iconBitmap = $iconCanvas.Bitmap
$g = $iconCanvas.Graphics
$g.Clear([System.Drawing.Color]::Transparent)
$iconBrush = [System.Drawing.SolidBrush]::new($teal)
Fill-RoundedRectangle $g $iconBrush 12 12 232 232 48
$g.FillRectangle([System.Drawing.SolidBrush]::new($tealDark), 12, 174, 232, 22)
Draw-RepairGlyph $g 55 52 146 $white $amber
$iconBitmap.Save((Join-Path $output 'icon-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$iconHandle = $iconBitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$iconStream = [System.IO.File]::Create((Join-Path $output 'icon.ico'))
$icon.Save($iconStream)
$iconStream.Dispose(); $icon.Dispose(); $iconBrush.Dispose(); $g.Dispose(); $iconBitmap.Dispose()

Write-Host "Installer assets generated in $output"
