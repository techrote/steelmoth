param(
    [Parameter(Mandatory=$true)][string]$ZipPath,
    [string]$RepoPath = (Get-Location).Path,
    [string]$Branch = 'sm-000-import-v123'
)

$ErrorActionPreference = 'Stop'
Set-Location $RepoPath

if (-not (Test-Path '.git')) { throw "RepoPath is not a git checkout: $RepoPath" }
if (-not (Test-Path $ZipPath)) { throw "ZIP not found: $ZipPath" }

Write-Host "[1/8] Fetching current repository state..."
git fetch origin

Write-Host "[2/8] Checking out import branch $Branch..."
if (git show-ref --verify --quiet "refs/heads/$Branch") {
    git checkout $Branch
} else {
    git checkout -b $Branch "origin/$Branch"
}
git pull --ff-only origin $Branch

Write-Host "[3/8] Importing and verifying authoritative v1.2.3 source tree..."
python tools/import_v123_archive.py $ZipPath --repo .

Write-Host "[4/8] Running JavaScript syntax checks..."
$JsFiles = @('engine/game.js','engine/surfacefx.js','engine/foliagefx.js','engine/editor.js','webapp.js')
foreach ($f in $JsFiles) { node --check $f }

Write-Host "[5/8] Running inherited release/renderer validators..."
$Validators = @(
    'tools/validate_webapp_v123.py',
    'tools/validate_v123_surface_coherence.py',
    'tools/validate_v122_coherence.py',
    'tools/validate_material_v2.py',
    'tools/validate_renderer_v120.py',
    'tools/validate_visual_material_v120.py',
    'tools/validate_ghost_material_v120.py',
    'tools/validate_webapp_v120.py',
    'tools/validate_glsl_v120.py'
)
foreach ($v in $Validators) { python $v }

Write-Host "[6/8] Running planning consistency check..."
python tools/validate_planning.py

Write-Host "[7/8] Staging exact baseline import..."
git add -A
$changes = git status --porcelain
if (-not $changes) {
    Write-Host 'No changes to commit.'
} else {
    git status --short
    git commit -m 'import: add verified Steel Moth v1.2.3 baseline source'
}

Write-Host "[8/8] Pushing branch..."
git push origin $Branch

Write-Host ''
Write-Host "Import branch pushed: $Branch"
Write-Host 'Next: open/review PR closing #1, run required checks, merge only if acceptance is genuinely satisfied.'
