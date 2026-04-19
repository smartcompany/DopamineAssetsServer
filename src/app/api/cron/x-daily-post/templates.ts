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

🚀 급등
{{U1_ROW}}
{{U2_ROW}}
{{U3_ROW}}

💀 급락
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
} as const satisfies Record<string, DailyPostTemplate>;

export default TEMPLATES;
