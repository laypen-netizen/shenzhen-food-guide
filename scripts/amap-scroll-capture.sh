#!/bin/zsh
set -euo pipefail

# Safely wrap huashu-mac-use's global pixel-wheel command for an already-frontmost
# iPhone Mirroring window. This script never activates or moves a window. Without
# --execute it only performs read-only/dry-run guards and does not send input.

MAC_BIN=${MAC_BIN:-"$HOME/.codex/skills/huashu-mac-use/scripts/mac"}
SCROLLER=${AMAP_SCROLLER:-"$PWD/.verification/continuous-scroll"}

usage() {
  cat <<'EOF'
Usage:
  scripts/amap-scroll-capture.sh <window-id> <output-dir> <sequence> \
    [--execute] [--dy -420] [--steps 8] [--mode wheel|drag] [--background]

Default: preflight only. --execute captures before/after PNGs and sends one
one guarded wheel or drag gesture. The iPhone Mirroring window must already be frontmost,
onscreen, unobscured at the target point, and the user must be idle.
With --background, wheel events are posted directly to the onscreen target PID;
the pointer is not moved and frontmost, occlusion, and idle checks are skipped.
EOF
}

[[ $# -ge 3 ]] || { usage; exit 1; }
window_id=$1
output_dir=$2
sequence=$3
shift 3

execute=0
dy=-420
steps=8
mode=wheel
background=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) execute=1; shift ;;
    --dy) [[ $# -ge 2 ]] || { usage; exit 1; }; dy=$2; shift 2 ;;
    --steps) [[ $# -ge 2 ]] || { usage; exit 1; }; steps=$2; shift 2 ;;
    --mode) [[ $# -ge 2 ]] || { usage; exit 1; }; mode=$2; shift 2 ;;
    --background) background=1; shift ;;
    *) print -u2 "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

[[ -x "$MAC_BIN" ]] || { print -u2 "Missing executable: $MAC_BIN"; exit 1; }
[[ "$window_id" == <-> ]] || { print -u2 "window-id must be an integer"; exit 1; }
[[ "$sequence" == <-> ]] || { print -u2 "sequence must be an integer"; exit 1; }
[[ "$dy" == -<-> || "$dy" == <-> ]] || { print -u2 "dy must be an integer"; exit 1; }
[[ "$steps" == <-> && "$steps" -ge 3 && "$steps" -le 20 ]] || { print -u2 "steps must be 3..20"; exit 1; }
[[ "$dy" -ge -1200 && "$dy" -le 1200 && "$dy" -ne 0 ]] || { print -u2 "dy must be between -1200 and 1200, excluding 0"; exit 1; }
[[ "$mode" == wheel || "$mode" == drag ]] || { print -u2 "mode must be wheel or drag"; exit 1; }
[[ "$mode" != drag || "$dy" -le -80 || "$dy" -ge 80 ]] || { print -u2 "drag dy must be at least 80 pixels"; exit 1; }
[[ "$background" -ne 1 || "$mode" == wheel ]] || { print -u2 "background mode supports wheel only"; exit 1; }

window_line() {
  "$MAC_BIN" windows --all | awk -v needle="id=$window_id " 'index($0,needle)==1 {match_line=$0} END {if(match_line!="") print match_line}'
}

field() {
  local line=$1 pattern=$2
  print -r -- "$line" | sed -E "$pattern"
}

preflight() {
  local line pid on ox oy width height local_x local_y key_dry hit_dry
  line=$(window_line)
  [[ -n "$line" ]] || { print -u2 "Window $window_id no longer exists"; return 2; }
  pid=$(field "$line" 's/.* pid=([0-9]+).*/\1/')
  on=$(field "$line" 's/.* on=([01]).*/\1/')
  ox=$(field "$line" 's/.* origin=\((-?[0-9]+),(-?[0-9]+)\).*/\1/')
  oy=$(field "$line" 's/.* origin=\((-?[0-9]+),(-?[0-9]+)\).*/\2/')
  width=$(field "$line" 's/.* ([0-9]+)x([0-9]+) title=.*/\1/')
  height=$(field "$line" 's/.* ([0-9]+)x([0-9]+) title=.*/\2/')
  [[ "$on" == 1 ]] || { print -u2 "refused: window is not on the current Space"; return 2; }
  [[ "$width" == <-> && "$height" == <-> && "$width" -gt 100 && "$height" -gt 200 ]] || { print -u2 "refused: invalid window bounds: $line"; return 2; }

  # Aim below the header and inside the mirrored phone content, using current
  # window geometry rather than cached absolute screen coordinates.
  local_x=$(( width * 50 / 100 ))
  local_y=$(( height * 65 / 100 ))

  if [[ "$background" -ne 1 ]]; then
    # `mac key --dry` is used only as a frontmost PID probe; keycode 125 is not sent.
    key_dry=$("$MAC_BIN" key "$pid" 125 --dry)
    [[ "$key_dry" == *"frontmost=pass"* ]] || { print -u2 "$key_dry"; print -u2 "refused: iPhone Mirroring is not frontmost"; return 2; }

    # `mac clickin --dry` safely checks current Space, topmost window at the point,
    # and user-presence state. Do not replace this with `mac scroll --dry`: the
    # current scroll implementation has no dry-run branch and would really scroll.
    hit_dry=$("$MAC_BIN" clickin "$window_id" "$local_x" "$local_y" --dry)
    [[ "$hit_dry" == *"跨Space=pass"* && "$hit_dry" == *"遮挡=pass"* && "$hit_dry" == *"在场=pass"* ]] || {
      print -u2 "$hit_dry"
      print -u2 "refused: Space, occlusion, or user-presence guard did not pass"
      return 2
    }
  fi

  PREFLIGHT_PID=$pid
  PREFLIGHT_X=$(( ox + local_x ))
  PREFLIGHT_Y=$(( oy + local_y ))
  PREFLIGHT_LINE=$line
  print -r -- "$line"
  if [[ "$mode" == drag ]]; then
    local end_y=$(( PREFLIGHT_Y + dy ))
    local bottom=$(( oy + height - 12 ))
    local top=$(( oy + 12 ))
    [[ "$end_y" -ge "$top" && "$end_y" -le "$bottom" ]] || { print -u2 "refused: drag endpoint y=$end_y is outside window safe bounds $top..$bottom"; return 2; }
  fi
  print -r -- "guarded input point=($PREFLIGHT_X,$PREFLIGHT_Y), mode=$mode, delivery=$([[ "$background" -eq 1 ]] && print postToPid || print global-HID), dy=$dy, steps=$steps"
}

preflight
if [[ "$execute" -ne 1 ]]; then
  print "preflight-only: no pointer, key, or scroll event was sent"
  print "phase plan (also no input):"
  if [[ -x "$SCROLLER" ]]; then
    scroller_args=(--window-id "$window_id" --pid "$PREFLIGHT_PID" --x "$PREFLIGHT_X" --y "$PREFLIGHT_Y" --distance "$dy" --steps "$steps" --mode "$mode")
    [[ "$background" -eq 1 ]] && scroller_args+=(--background)
    "$SCROLLER" "${scroller_args[@]}"
  else
    print "  compile first: swiftc -O scripts/continuous-scroll.swift -o .verification/continuous-scroll"
  fi
  exit 0
fi

[[ -x "$SCROLLER" ]] || { print -u2 "Missing phased scroller: $SCROLLER\nCompile with: swiftc -O scripts/continuous-scroll.swift -o .verification/continuous-scroll"; exit 1; }
mkdir -p "$output_dir"
printf -v sequence_padded '%04d' "$sequence"
before="$output_dir/capture-$sequence_padded-before.png"
after="$output_dir/capture-$sequence_padded-after.png"
[[ ! -e "$before" && ! -e "$after" ]] || { print -u2 "refused: capture files already exist for sequence $sequence_padded"; exit 2; }

"$MAC_BIN" shot "$window_id" "$before"
# Recheck immediately before the global event and recompute coordinates in case
# the user moved the window while the before screenshot was being written.
preflight
scroller_args=(--window-id "$window_id" --pid "$PREFLIGHT_PID" --x "$PREFLIGHT_X" --y "$PREFLIGHT_Y" --distance "$dy" --steps "$steps" --mode "$mode")
[[ "$background" -eq 1 ]] && scroller_args+=(--background)
"$SCROLLER" "${scroller_args[@]}" --execute
sleep 0.8
"$MAC_BIN" shot "$window_id" "$after"

before_hash=$(shasum -a 256 "$before" | awk '{print $1}')
after_hash=$(shasum -a 256 "$after" | awk '{print $1}')
print "before=$before"
print "after=$after"
print "before_sha256=$before_hash"
print "after_sha256=$after_hash"
if [[ "$before_hash" == "$after_hash" ]]; then
  print -u2 "unknown: before and after screenshots are byte-identical; do not advance the sequence as if scrolling succeeded"
  exit 2
fi
print "changed: screenshots differ; verify list movement with OCR/visual overlap before accepting the step"
