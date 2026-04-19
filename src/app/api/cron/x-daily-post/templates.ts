// 10종 일일 X 포스트 템플릿.
// `{{KEY}}` placeholder는 route.ts의 renderTemplate에서 치환한다.
// 지원 키 목록은 route.ts 주석 참고. 편집은 이 파일만 수정하면 된다.
// - text의 백틱 안 개행/공백이 그대로 출력된다 (indent 주의: 모든 줄은 column 0에서 시작).
// - 이모지/특수문자는 그냥 입력하면 된다.
// - 트윗 weight 리미트(280) 근처인 템플릿(ranking, fire_ice)은 헤더 길이 건드릴 때 주의.
//
// gif 필드:
//   - Giphy / Tenor 등의 **직접 .gif 파일 URL**을 넣는다.
//     예) https://media.giphy.com/media/<id>/giphy.gif
//     예) https://media1.tenor.com/.../tenor.gif
//     Giphy "페이지 URL"(giphy.com/gifs/...)은 파싱이 필요해 지원하지 않는다.
//   - 비워두면 텍스트만 올라간다.
//   - 파일 크기 <= 15MB, 한 덩어리가 > 4MB면 자동 chunk로 나눠 업로드.
//   - 다운로드/업로드 실패해도 텍스트만은 올라가도록 fail-soft 처리됨.

export type DailyPostTemplate = {
  text: string;
  gif?: string;
};

const TEMPLATES = {
  // 1) 기본 순위: 상승/하락 TOP3 (헤더 짧게 유지 — weight budget 타이트)
  ranking: {
    text: `🤯 오늘의 수익률 TOP3

🚀
{{U1_ROW}}
{{U2_ROW}}
{{U3_ROW}}

💀
{{D1_ROW}}
{{D2_ROW}}
{{D3_ROW}}

{{URL}}`,
    // 핵폭발 + "mind blown" 느낌. 수익률 쇼크 헤더와 매칭.
    gif: "https://media.giphy.com/media/LOzG6sOM9S0Q8/giphy.gif",
  },

  // 2) TOP1 급등 스포트라이트
  spotlight_up: {
    text: `🚨 "{{U1_NAME_18}}" ({{U1_SYM}})
하루 만에 {{U1_PCT}}... 이거 실화냐 🤯

차트 보다 눈 의심했음 👁️
오늘의 미친 급등 TOP3 👇
{{URL}}`,
    // 우주 폭발 애니메이션. "터졌다" 강조.
    gif: "https://media.giphy.com/media/l41JS0g6UPOoKV7Z6/giphy-downsized.gif",
  },

  // 3) TOP1 급락 스포트라이트
  spotlight_down: {
    text: `💀 "{{D1_NAME_18}}" ({{D1_SYM}})
하루 만에 {{D1_PCT}} 증발 🫠

관짝 제작 완료.
아직 못 판 사람들... 괜찮음? 🥲
{{URL}}`,
    // 돈 들고 슬퍼하는 모션. "증발" 분위기.
    gif: "https://media.giphy.com/media/1yiz6MZCuqcUXwVnnG/giphy-downsized.gif",
  },

  // 4) 호기심 퀴즈
  quiz: {
    text: `⚡ 오늘의 수익률 쇼크
이 심볼들 몇 개나 앎?

🚀 미친 놈들: {{U1_SYM}} · {{U2_SYM}} · {{U3_SYM}}
💀 작살난 놈들: {{D1_SYM}} · {{D2_SYM}} · {{D3_SYM}}

{{URL}}`,
    // CP+R "hmm, thinking" 반응. 퀴즈/궁금증 유도.
    gif: "https://media.giphy.com/media/FLPbENXvM0AP8xMf5G/giphy-downsized.gif",
  },

  // 5) 불/얼음 → 폭발/박살 (weight 타이트 — 섹션 헤더 최소화)
  fire_ice: {
    text: `🔥 폭발한 종목
{{U1_BULLET}}
{{U2_BULLET}}
{{U3_BULLET}}

💀 박살난 종목
{{D1_BULLET}}
{{D2_BULLET}}
{{D3_BULLET}}

{{URL}}`,
    // 화염 폭발 "BOOM" — 불/파괴 양쪽 다 커버.
    gif: "https://media.giphy.com/media/O3GqAYR9jFxLi/giphy.gif",
  },

  // 6) 속보 스타일
  news_flash: {
    text: `🚨 [속보] 오늘 증시 미쳤음

⚡ 급등 1위: {{U1_NAME_14}} {{U1_PCT}}
💀 급락 1위: {{D1_NAME_14}} {{D1_PCT}}

전체 순위 👇
{{URL}}`,
    // Quixy 브레이킹 뉴스 배너. 속보 분위기 완벽.
    gif: "https://media.giphy.com/media/bRjZMza96ThpHewTAE/giphy-downsized.gif",
  },

  // 7) 오늘의 영수증
  receipt: {
    text: `🧾 오늘의 수익 영수증

[천국행 🚀]
{{U1_BULLET}}
{{U2_BULLET}}

[지옥행 💀]
{{D1_BULLET}}
{{D2_BULLET}}

너는 어느 쪽에 탔음?
{{URL}}`,
    // "Make it rain" 달러 다발. 영수증/돈 테마.
    gif: "https://media.giphy.com/media/7zXfuwKh8HdauQNqqF/giphy.gif",
  },

  // 8) 오늘의 질문
  question: {
    text: `📈 "{{U1_NAME}}" 하루 만에 {{U1_PCT}}.

내일도 감? 아니면 꼭지? 🫠
올라탈 용기 있음?

오늘의 미친 순위 👇
{{URL}}`,
    // WUFFI 캐릭터 shrug/idk — "모르겠는데?" 정확히 매칭.
    gif: "https://media.giphy.com/media/1qw2KHHWIHlie4bQKc/giphy.gif",
  },

  // 9) 급등 3종 심플
  top3_up_only: {
    text: `🚀 오늘 미친 급등 TOP3
{{U1_ROW}}
{{U2_ROW}}
{{U3_ROW}}

이게 주식이냐 로또냐 🤯
{{URL}}`,
    // DOMCAKE "Skyrocket / gamestonk" — 주식 로켓 대표 밈.
    gif: "https://media.giphy.com/media/QQ1K0jv4JyUR750vrr/giphy-downsized.gif",
  },

  // 10) 급락 3종 반전
  top3_down_only: {
    text: `💀 오늘 박살난 급락 TOP3
{{D1_ROW}}
{{D2_ROW}}
{{D3_ROW}}

계좌 녹는 소리 들림 🫠
{{URL}}`,
    // 해골 댄스("Dance of Death"). 계좌 녹음 + 💀 톤 매칭.
    gif: "https://media.giphy.com/media/xyFpHGNvnwEphb0jlF/giphy-downsized.gif",
  },

  // 11) 자랑 유도 — "이거 미리 탄 사람 자랑좀"
  bragger: {
    text: `🏆 오늘의 주식 왕좌

{{U1_NAME_18}} ({{U1_SYM}})
하루 만에 {{U1_PCT}} 쓸어감 👑

이거 미리 탄 사람, 한 번만 자랑좀 🙏
{{URL}}`,
    gif: "https://media.giphy.com/media/3o6MbeDiaHJaF2EuQM/giphy-downsized.gif",
  },

  // 12) 경고 — 하락 종목 조심
  warning: {
    text: `⚠️ [경고] 이 종목들 조심해

❌ {{D1_SYM}} {{D1_PCT}}
❌ {{D2_SYM}} {{D2_PCT}}
❌ {{D3_SYM}} {{D3_PCT}}

오늘 피하라는 신호임 🚫
{{URL}}`,
    gif: "https://media.giphy.com/media/h0xTsaoIUOZGT2GuFl/giphy.gif",
  },

  // 13) 축하 파티 — confetti
  celebration: {
    text: `🎉 오늘의 파티 주인공

🥂 {{U1_SYM}} {{U1_PCT}}
🥂 {{U2_SYM}} {{U2_PCT}}
🥂 {{U3_SYM}} {{U3_PCT}}

증시 축하 파티 열림 🍾
{{URL}}`,
    gif: "https://media.giphy.com/media/KyIb22PC9GGdomKGUG/giphy-downsized.gif",
  },

  // 14) 탐정 — Sherlock 톤
  detective: {
    text: `🔍 오늘 "{{U1_NAME_18}}" 수사 의뢰

단서: 하루 만에 {{U1_PCT}}
용의자: 누가 밀어올렸나? 🕵️

진실은... 여기서 👇
{{URL}}`,
    gif: "https://media.giphy.com/media/kbUXGJHxS80O1GJwEx/giphy.gif",
  },

  // 15) 일기 — 한 줄 요약
  diary: {
    text: `💭 오늘 증시 한 줄 요약

"미친 {{U1_SYM}}, 죽은 {{D1_SYM}}."
그 이상도 이하도 아님 🫠

전체 순위 보기 👇
{{URL}}`,
    gif: "https://media.giphy.com/media/WwK9nYJ2VuhP3iUoWZ/giphy.gif",
  },

  // 16) 카지노/잭팟
  casino: {
    text: `🎰 오늘의 잭팟 종목

🎲 {{U1_SYM}} {{U1_PCT}}
🎲 {{U2_SYM}} {{U2_PCT}}
🎲 {{U3_SYM}} {{U3_PCT}}

주식이냐 슬롯머신이냐 🤑
{{URL}}`,
    gif: "https://media.giphy.com/media/idG0ptkLQWvECYb6fW/giphy-downsized.gif",
  },

  // 17) 조롱 — 손절 유발자
  roast: {
    text: `🤡 오늘의 손절 유발자

{{D1_NAME_18}} ({{D1_SYM}})
{{D1_PCT}}... 어디까지 빠져?

존버러들 다 어디 갔냐 👻
{{URL}}`,
    gif: "https://media.giphy.com/media/l1J9qOI6osntSEL04/giphy-downsized.gif",
  },

  // 18) 운세/점괘
  horoscope: {
    text: `🔮 오늘의 증시 운세

📈 상승운: {{U1_SYM}} · {{U2_SYM}}
📉 하락운: {{D1_SYM}} · {{D2_SYM}}

내일 뭐 살까? 🤔
{{URL}}`,
    gif: "https://media.giphy.com/media/98CXZ9LMBLlzsE4jIS/giphy.gif",
  },

  // 19) 대결 — 1위 vs 1위 KO
  battle: {
    text: `⚔️ 오늘의 증시 매치업

🔵 {{U1_SYM}} {{U1_PCT}}
🔴 {{D1_SYM}} {{D1_PCT}}

승자 {{U1_SYM}}. KO 승 🥊
{{URL}}`,
    gif: "https://media.giphy.com/media/0imDX3iIkgbEHbgVWz/giphy.gif",
  },

  // 20) 상폐빔 meme
  crying_meme: {
    text: `😭 상폐빔 맞은 느낌

"{{D1_NAME_18}}" ({{D1_SYM}})
{{D1_PCT}} 처참함 💣

청약자 명복을 빕니다 🙏
{{URL}}`,
    gif: "https://media.giphy.com/media/94GrXnEGRffGU2CcfP/giphy.gif",
  },

  // 21) 충격 편차 표시
  shock_meter: {
    text: `📊 오늘의 수익률 편차

📈 최고: {{U1_SYM}} {{U1_PCT}}
📉 최저: {{D1_SYM}} {{D1_PCT}}

이 차이 실화임? 🤯
{{URL}}`,
    gif: "https://media.giphy.com/media/s4W4zMzyV6oIo/giphy-downsized.gif",
  },

  // 22) 비상 — 매도벽
  emergency: {
    text: `🆘 [비상] 매도벽 뚫림

"{{D1_NAME_18}}" ({{D1_SYM}}) {{D1_PCT}}
지지선 붕괴... 🫠

다른 급락 종목 👇
{{URL}}`,
    gif: "https://media.giphy.com/media/YO7P8VC7nlQlO/giphy-downsized.gif",
  },

  // 23) 역주행 comeback
  comeback: {
    text: `💪 오늘의 역주행 스타

{{U1_SYM}} {{U1_PCT}} 🔥
{{U2_SYM}} {{U2_PCT}} 🔥
{{U3_SYM}} {{U3_PCT}} 🔥

증시가 불타고 있음 🚀
{{URL}}`,
    gif: "https://media.giphy.com/media/qxuK0ct226KJdgh1ZU/giphy.gif",
  },

  // 24) MVP/명예의 전당
  hall_of_fame: {
    text: `🏆 오늘의 MVP 종목

{{U1_NAME_18}} ({{U1_SYM}})
{{U1_PCT}} 🎯

명예의 전당 입성 👑
{{URL}}`,
    gif: "https://media.giphy.com/media/a70gdGBpnj7YEddYre/giphy-downsized.gif",
  },

  // 25) 가십 — 소문 형식
  gossip: {
    text: `👀 오늘 떠도는 소문

"{{U1_SYM}} {{U1_PCT}}?? 뭐 터졌음?"
"{{D1_SYM}}는 왜 또 망함?"

팩트 체크 가자 👇
{{URL}}`,
    gif: "https://media.giphy.com/media/UVpYKeRaZ7SyboUUoJ/giphy-downsized.gif",
  },

  // 26) 로봇 자동 리포트
  robot: {
    text: `🤖 [AUTO REPORT]

> 급등 1위: {{U1_SYM}} [{{U1_PCT}}]
> 급락 1위: {{D1_SYM}} [{{D1_PCT}}]
> VOLATILITY: HIGH

FULL DATA 👇
{{URL}}`,
    gif: "https://media.giphy.com/media/ylvhS8cpKWBqiv7Ply/giphy-downsized.gif",
  },

  // 27) 종말의 전조
  apocalypse: {
    text: `☠️ 시장 종말의 전조

{{D1_SYM}} {{D1_PCT}}
{{D2_SYM}} {{D2_PCT}}
{{D3_SYM}} {{D3_PCT}}

모두 한 방향... 수상함 🫥
{{URL}}`,
    gif: "https://media.giphy.com/media/jZqTlkgJ9F4H0isjef/giphy-downsized.gif",
  },

  // 28) 달까지
  to_the_moon: {
    text: `🌕 달까지 날아간 종목

"{{U1_NAME_18}}" {{U1_PCT}}

지구와 이별 완료 👋🚀
다음 정거장은 화성? 🔴
{{URL}}`,
    gif: "https://media.giphy.com/media/uKkud3HmUZlPW/giphy-downsized.gif",
  },

  // 29) 고백 타임
  confession: {
    text: `🤫 오늘의 고백 타임

"어제 {{D1_SYM}} 샀는데 {{D1_PCT}} 🫠"
"{{U1_SYM}} 왜 안 샀지... {{U1_PCT}}"

너는 오늘 어땠음?
{{URL}}`,
    gif: "https://media.giphy.com/media/mTtDdazMpaFi0/giphy-downsized.gif",
  },

  // 30) 하이프
  hype: {
    text: `🔥🔥🔥 오늘 핫한 종목들

{{U1_SYM}} {{U1_PCT}}
{{U2_SYM}} {{U2_PCT}}
{{U3_SYM}} {{U3_PCT}}

전부 불타는 중 ♨️
{{URL}}`,
    gif: "https://media.giphy.com/media/MXcqj6jOhr4R99iFZv/giphy-downsized.gif",
  },
} as const satisfies Record<string, DailyPostTemplate>;

export default TEMPLATES;
