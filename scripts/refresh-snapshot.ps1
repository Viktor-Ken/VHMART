$snapshotDir = Join-Path $PSScriptRoot '..'
$scriptPath = Join-Path $PSScriptRoot 'generate-products-snapshot.js'

function Invoke-Generate {
    try {
        $output = & node $scriptPath 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
        return $output
    } catch {
        return "ERR|$($_.Exception.Message)"
    }
}

$result = Invoke-Generate
Write-Output $result
if ($result -match '^ERR') {
    Write-Output 'VHMART SNAPSHOT FAILED'
    exit 1
}
Write-Output 'VHMART SNAPSHOT OK'
exit 0