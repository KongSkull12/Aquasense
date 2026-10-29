param(
  [string[]]$Paths = @("Backend/.env", "Frontend/.env")
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required"
}

if (-not (Get-Command git-filter-repo -ErrorAction SilentlyContinue)) {
  throw "git-filter-repo is required. Install it first, then rerun this script from a fresh clone."
}

$status = git status --porcelain
if ($status) {
  throw "Working tree is not clean. Commit or stash changes before rewriting history."
}

foreach ($path in $Paths) {
  git filter-repo --path $path --invert-paths --force
}

Write-Host "History purge complete. Rotate exposed secrets, then force-push the rewritten branch."
