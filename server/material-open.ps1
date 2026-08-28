param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

if (-not (Test-Path -LiteralPath $Path)) {
  throw 'The indexed material no longer exists.'
}

Invoke-Item -LiteralPath $Path
