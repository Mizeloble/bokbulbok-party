#!/usr/bin/env bash
# 광고물(promo) 합성 — capture-promo.mjs의 게임별 webm + render-promo-cards.mjs의 텍스트
# 카드(PNG)를 합쳐 1080×1920 세로 광고 1편으로. 무음(플랫폼에서 트렌딩 음원 얹기 권장).
#
# 이 ffmpeg 빌드엔 drawtext(freetype)가 없어 자막은 브라우저에서 PNG로 렌더 후 overlay 합성.
#
# 선행: node scripts/capture-promo.mjs {marble,reaction,trivia}  → /tmp/bbb-promo/*.webm
#       node scripts/render-promo-cards.mjs                      → /tmp/promo-work/cards/*.png
# 산출: /tmp/bokbulbok-promo.mp4
set -euo pipefail

IN=/tmp/bbb-promo
WORK=/tmp/promo-work
CARDS=$WORK/cards
OUT=/tmp/bokbulbok-promo.mp4
W=1080; H=1920; FPS=30

ENC=(-c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -r $FPS -an)

# 정지 카드(인트로/아웃트로) → 비디오. 가벼운 페이드인.
card_clip() { # png dur out
  ffmpeg -y -loop 1 -t "$2" -i "$1" \
    -vf "scale=$W:$H,fps=$FPS,format=yuv420p,fade=in:0:10" \
    "${ENC[@]}" "$3"
}

# 게임 세그먼트: webm 구간 → 업스케일 → 투명 라벨칩 PNG overlay.
seg_game() { # webm start dur capPng out
  ffmpeg -y -ss "$2" -t "$3" -i "$1" -i "$4" \
    -filter_complex "[0:v]scale=$W:$H:flags=lanczos,fps=$FPS,setsar=1[v];\
[v][1:v]overlay=0:0:format=auto,format=yuv420p[o]" \
    -map "[o]" "${ENC[@]}" "$5"
}

# 마블 결과(payoff) 시작 = 전체 길이 - 3.5초
MDUR=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$IN/marble.webm")
PAYSTART=$(awk "BEGIN{print $MDUR-3.5}")

card_clip "$CARDS/intro.png" 2.2 "$WORK/0_intro.mp4"
seg_game  "$IN/marble.webm"   6.0 3.8 "$CARDS/cap_marble.png"   "$WORK/1_marble.mp4"
seg_game  "$IN/reaction.webm" 4.3 3.0 "$CARDS/cap_reaction.png" "$WORK/2_reaction.mp4"
seg_game  "$IN/trivia.webm"   7.2 3.6 "$CARDS/cap_trivia.png"   "$WORK/3_trivia.mp4"
seg_game  "$IN/marble.webm"   "$PAYSTART" 3.5 "$CARDS/cap_payoff.png" "$WORK/4_payoff.mp4"
card_clip "$CARDS/outro.png" 2.8 "$WORK/5_outro.mp4"

printf "file '%s'\n" "$WORK"/0_intro.mp4 "$WORK"/1_marble.mp4 "$WORK"/2_reaction.mp4 \
  "$WORK"/3_trivia.mp4 "$WORK"/4_payoff.mp4 "$WORK"/5_outro.mp4 > "$WORK/list.txt"
ffmpeg -y -f concat -safe 0 -i "$WORK/list.txt" -c copy -movflags +faststart "$OUT"

echo "=== built $OUT ==="
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of default=nw=1 "$OUT"
