@echo off
cd /d "%~dp0"
echo ======================================================
echo  VoiceSuite Studio ローカルサーバーを起動しています...
echo ======================================================

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Python を検知しました。サーバーを起動します...
    start http://127.0.0.1:8080/voice-demo.html
    python -m http.server 8080
) else (
    echo PowerShell 簡易サーバーを起動します...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$listener = New-Object System.Net.HttpListener;" ^
      "$listener.Prefixes.Add('http://127.0.0.1:8080/');" ^
      "$listener.Start();" ^
      "Write-Host 'ブラウザを開いています...';" ^
      "Start-Process 'http://127.0.0.1:8080/voice-demo.html';" ^
      "while($listener.IsListening){" ^
      "  $context = $listener.GetContext();" ^
      "  $file = Join-Path $pwd ($context.Request.Url.LocalPath.TrimStart('/'));" ^
      "  if(Test-Path $file){" ^
      "    [byte[]]$b = [System.IO.File]::ReadAllBytes($file);" ^
      "    $context.Response.OutputStream.Write($b, 0, $b.Length);" ^
      "  }" ^
      "  $context.Response.Close();" ^
      "}"
)
pause