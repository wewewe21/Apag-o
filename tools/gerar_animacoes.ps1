# Gera as animacoes da criatura com o kimodo.cpp (texto -> movimento).
# Uso: .\tools\gerar_animacoes.ps1            (gera tudo)
#      .\tools\gerar_animacoes.ps1 -Only run  (gera so um clipe)
# Saida: tools\kimodo_raw\<clipe>_s<seed>\{root_positions.f32, local_rotations_xyzw.f32}
# Depois rode: python tools\kimodo_to_game.py   (empacota em assets\anim\creature.json)
# Onde esta o kimodo.cpp: -KimodoDir, a variavel KIMODO_DIR ou ..\..\kimodo.cpp (ao lado da pasta do jogo).
param([string]$Only = "", [string]$KimodoDir = "")

$ErrorActionPreference = "Continue"
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $KimodoDir) { $KimodoDir = $env:KIMODO_DIR }
if (-not $KimodoDir) { $KimodoDir = Join-Path $here "..\..\kimodo.cpp" }
# aceita build Release ou Debug (o kimodo-ai costuma ter so build\debug)
$buildDir = $null
foreach ($b in @("build\Release", "build\debug", "build\Debug")) { if (Test-Path (Join-Path $KimodoDir ($b + "\kmd-generate.exe"))) { $buildDir = $b; break } }
if (-not $buildDir) {
  Write-Error "kmd-generate.exe nao encontrado em '$KimodoDir'. Use -KimodoDir <pasta do kimodo.cpp> ou defina KIMODO_DIR."; exit 1
}
$kimodo  = Resolve-Path $KimodoDir
$exe     = Join-Path $kimodo ($buildDir + "\kmd-generate.exe")
$motion  = Join-Path $kimodo "models\kimodo-soma-rp-v1.1-f32.gguf"
$text    = Join-Path $kimodo "Llama-3-Kimodo-Q8_0.gguf"
$outRoot = Join-Path $here "kimodo_raw"
$env:PATH = "$kimodo\$buildDir;$kimodo\$buildDir\bin;$kimodo\build\bin\Release;$kimodo\build\Release;" + $env:PATH

# nome, frames (30 fps), seeds, prompt
$clips = @(
  @("walk",    120, @(7, 11),  "a person walks slowly forward, hunched over, with arms hanging loosely"),
  @("limp",    120, @(1, 2),   "a person walks forward with a heavy limp, dragging the left leg"),
  @("stalk",   120, @(3, 9),   "a person sneaks forward slowly while crouching low"),
  @("run",      90, @(1, 5),   "a person runs forward quickly, leaning forward aggressively"),
  @("recoil",   75, @(2, 8),   "a person stumbles backwards covering their face with both arms"),
  @("look",    150, @(4, 6),   "a person stands in place and looks around to the left and to the right"),
  @("inspect",  90, @(1, 2),   "a person leans forward and looks closely at something in front of them"),
  @("attack",   60, @(3, 7),   "a person lunges forward and grabs with both hands"),
  @("idle",    120, @(1, 4),   "a person stands still, breathing heavily, with the head tilted to the side"),
  @("roar",     75, @(1, 2),   "a person screams angrily with both arms spread wide"),
  @("crawl",   120, @(1, 3),   "a person crawls forward on hands and knees"),
  # marchas novas de patrulha (a "limp" arrasta a perna; estas sao passos normais, lentos e ameacadores)
  @("creep",   120, @(4, 8, 12), "a person walks slowly and deliberately forward with small careful steps, standing upright with arms hanging at the sides and the head tilted"),
  @("prowl",   120, @(3, 6, 9),  "a tall thin person walks forward slowly with long careful steps, swaying slightly, looking ahead"),
  # reacao curta de dor quando a luz queima o rosto (camada so do tronco/cabeca/bracos no jogo)
  @("pain",     45, @(2, 5, 9), "a person flinches sharply in pain, jerking the head back and raising one hand to cover the eyes")
)

foreach ($c in $clips) {
  $name = $c[0]; $frames = $c[1]; $seeds = $c[2]; $prompt = $c[3]
  if ($Only -and $Only -ne $name) { continue }
  foreach ($seed in $seeds) {
    $out = Join-Path $outRoot ("{0}_s{1}" -f $name, $seed)
    if (Test-Path (Join-Path $out "local_rotations_xyzw.f32")) { Write-Output "ja existe: $out"; continue }
    New-Item -ItemType Directory -Force $out | Out-Null
    $pf = Join-Path $out "prompt.txt"
    [IO.File]::WriteAllText($pf, $prompt, (New-Object Text.UTF8Encoding $false))
    $sw = [Diagnostics.Stopwatch]::StartNew()
    # barra normal no fim: no PowerShell 5.1, "$out\" vira um argumento com aspas soltas e o kimodo nao consegue gravar
    $outArg = $out.Replace([string][char]92, '/') + '/'
    & $exe $motion $text $pf $frames 50 $seed $outArg 2>&1 | Out-Null
    $sw.Stop()
    Write-Output ("{0,-8} seed {1,-3} -> exit {2} ({3:N1}s)" -f $name, $seed, $LASTEXITCODE, $sw.Elapsed.TotalSeconds)
  }
}
Write-Output "FIM"
