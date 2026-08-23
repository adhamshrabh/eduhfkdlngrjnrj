Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
    param([float]$x, [float]$y, [float]$w, [float]$h, [float]$r)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-StarPoints {
    param([float]$cx, [float]$cy, [float]$outerR, [float]$innerR)
    $points = New-Object System.Collections.Generic.List[System.Drawing.PointF]
    for ($i = 0; $i -lt 10; $i++) {
        $angle = [Math]::PI / 5 * $i - [Math]::PI / 2
        $r = if ($i % 2 -eq 0) { $outerR } else { $innerR }
        $px = $cx + [Math]::Cos($angle) * $r
        $py = $cy + [Math]::Sin($angle) * $r
        $points.Add((New-Object System.Drawing.PointF($px, $py)))
    }
    return $points.ToArray()
}

function Render-Icon {
    param([int]$size, [string]$outPath)

    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # خلفية: مربّع مدوّر بتدرّج بنفسجي — نفس تدرّج العلامة بالتطبيق
    $bgPath = New-RoundedRectPath -x 0 -y 0 -w $size -h $size -r ($size * 0.22)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF($size, $size)),
        [System.Drawing.Color]::FromArgb(255, 127, 119, 221),
        [System.Drawing.Color]::FromArgb(255, 83, 74, 183)
    )
    $g.FillPath($bgBrush, $bgPath)

    # الكتاب: مستطيل أبيض مدوّر بمنتصف العرض، مع خط طيّ مركزي
    $bookW = $size * 0.58
    $bookH = $size * 0.40
    $bookX = ($size - $bookW) / 2
    $bookY = ($size - $bookH) / 2 + $size * 0.02
    $bookPath = New-RoundedRectPath -x $bookX -y $bookY -w $bookW -h $bookH -r ($size * 0.05)
    $bookBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(242, 255, 255, 255))
    $g.FillPath($bookBrush, $bookPath)

    $creasePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 127, 119, 221), [Math]::Max(1, $size * 0.012))
    $g.DrawLine($creasePen, $size / 2, $bookY + $size * 0.03, $size / 2, $bookY + $bookH - $size * 0.03)

    # سطور صفحة خفيفة على كل جهة — تلمح لنص بلا كتابة فعلية
    $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 127, 119, 221), [Math]::Max(1, $size * 0.01))
    for ($i = 0; $i -lt 3; $i++) {
        $ly = $bookY + $bookH * 0.28 + $i * ($bookH * 0.2)
        $g.DrawLine($linePen, $bookX + $bookW * 0.12, $ly, $size / 2 - $bookW * 0.06, $ly)
        $g.DrawLine($linePen, $size / 2 + $bookW * 0.06, $ly, $bookX + $bookW * 0.88, $ly)
    }

    # نجمة صفراء صغيرة أعلى اليمين — لمسة مرحة
    $starPts = New-StarPoints -cx ($size * 0.775) -cy ($size * 0.225) -outerR ($size * 0.09) -innerR ($size * 0.038)
    $starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 226, 138))
    $g.FillPolygon($starBrush, $starPts)

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "wrote $outPath ($size x $size)"
}

$iconsDir = "C:\Users\LCT\Desktop\t4c1\edu-platform\frontend\apps\web\public\icons"
Render-Icon -size 192 -outPath (Join-Path $iconsDir "icon-192.png")
Render-Icon -size 512 -outPath (Join-Path $iconsDir "icon-512.png")
