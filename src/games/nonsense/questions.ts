// 넌센스 퀴즈 문제 풀. 한국어 전용. 가볍고 누구나 웃는 파티 톤 — 말장난·언어유희와
// 재치/상황추론(엉뚱한 논리)을 섞는다. 정치·종교·민감 주제 제외. trivia와 동일 스키마라
// trivia 엔진(buildQuizPlan/computeQuizResult)이 그대로 채점·재생한다.
//
// 문항 추가: 배열 끝에 append하고 새 id(kebab-case)만 부여. 기존 순서 바꾸지 말 것 —
// 서버가 seed 기반으로 섞고, 풀 자체는 런타임에 id 사전순(NONSENSE_POOL_SORTED)으로
// 정렬한 뒤 추출하므로 삽입 순서는 결정성에 영향 없음.
//
// 카피 규칙: question ~40자, choices 각 ~10자(모바일 한 줄). 정답 외 3개는 그럴싸한 함정.

export type NonsenseCategory = '말장난' | '재치' | '상황추론';

export type NonsenseQuestion = {
  id: string;
  category: NonsenseCategory;
  question: string;
  choices: readonly [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  /** 정답 공개 화면에 뜨는 한 줄 해설. ≤80자. 답이 자명하면 생략. */
  note?: string;
};

export const NONSENSE_POOL: readonly NonsenseQuestion[] = [
  // ── 말장난 ────────────────────────────────────────────────────
  {
    id: 'pun-king-fall',
    category: '말장난',
    question: '왕이 넘어지면?',
    choices: ['임금님', '킹콩', '왕쾅', '폭삭'],
    correctIndex: 1,
    note: "킹(king)이 '콩' 하고 넘어졌으니 킹콩.",
  },
  {
    id: 'pun-fast-chicken',
    category: '말장난',
    question: '세상에서 가장 빠른 닭은?',
    choices: ['번개닭', '후다닭', '제트닭', '총알닭'],
    correctIndex: 1,
    note: "'후다닥' + 닭.",
  },
  {
    id: 'pun-cold-sea',
    category: '말장난',
    question: '세상에서 가장 추운 바다는?',
    choices: ['북극해', '동해', '썰렁해', '냉해'],
    correctIndex: 2,
    note: '썰렁해~',
  },
  {
    id: 'pun-two-foot-cow',
    category: '말장난',
    question: '발이 두 개 달린 소는?',
    choices: ['정육점', '외양간', '이발소', '목장'],
    correctIndex: 2,
    note: '이(2)발 + 소 = 이발소.',
  },
  {
    id: 'pun-kind-lion',
    category: '말장난',
    question: '세상에서 가장 친절한 사자는?',
    choices: ['의사', '자원봉사자', '변호사', '요리사'],
    correctIndex: 1,
    note: "봉사 + '자'로 끝나는 사자(者).",
  },
  {
    id: 'pun-thief-icecream',
    category: '말장난',
    question: '도둑이 가장 무서워하는 아이스크림은?',
    choices: ['월드콘', '스크류바', '누가바', '빵빠레'],
    correctIndex: 2,
    note: "'누가 봐?'",
  },
  {
    id: 'pun-hot-fruit',
    category: '말장난',
    question: '세상에서 가장 뜨거운 과일은?',
    choices: ['한라봉', '천도복숭아', '파인애플', '용과'],
    correctIndex: 1,
    note: '천도(1000도) 복숭아.',
  },
  {
    id: 'pun-high-chief',
    category: '말장난',
    question: '추장보다 높은 사람은?',
    choices: ['부족장', '고추장', '대추장', '면장'],
    correctIndex: 1,
    note: '고(高) + 추장.',
  },
  {
    id: 'pun-dirty-river',
    category: '말장난',
    question: '세상에서 가장 더러운 강은?',
    choices: ['한강', '낙동강', '요강', '압록강'],
    correctIndex: 2,
    note: '요강(옛날 실내 변기).',
  },
  {
    id: 'pun-laughing-cow',
    category: '말장난',
    question: '소가 크게 웃으면?',
    choices: ['음매', '우하하', '깔깔', '메에'],
    correctIndex: 1,
    note: '소 우(牛) + 하하.',
  },
  {
    id: 'pun-burger-color',
    category: '말장난',
    question: '햄버거의 색깔은?',
    choices: ['갈색', '노랑', '버건디', '빨강'],
    correctIndex: 2,
    note: '버거 + ㄴ디 = 버건디.',
  },
  {
    id: 'pun-dad-lost',
    category: '말장난',
    question: '아빠가 길을 잃으면?',
    choices: ['길치', '파파라치', '마마보이', '미아'],
    correctIndex: 1,
    note: '파파(아빠) + 라치.',
  },

  // ── 재치 ─────────────────────────────────────────────────────
  {
    id: 'wit-months-28',
    category: '재치',
    question: '28일이 있는 달은 1년에 몇 개?',
    choices: ['1개', '2개', '4개', '12개'],
    correctIndex: 3,
    note: '모든 달이 최소 28일은 있다.',
  },
  {
    id: 'wit-cotton-iron',
    category: '재치',
    question: '1kg의 솜과 1kg의 쇠, 더 무거운 것은?',
    choices: ['솜', '쇠', '똑같다', '알 수 없음'],
    correctIndex: 2,
    note: '둘 다 1kg.',
  },
  {
    id: 'wit-alphabet-letters',
    category: '재치',
    question: "'알파벳'에는 글자가 몇 개 들어 있을까?",
    choices: ['26개', '3개', '24개', '알 수 없음'],
    correctIndex: 1,
    note: "단어 '알·파·벳' 세 글자.",
  },
  {
    id: 'wit-right-hand',
    category: '재치',
    question: '오른손으로 절대 만질 수 없는 것은?',
    choices: ['왼손', '오른팔', '오른손', '오른발'],
    correctIndex: 2,
    note: '오른손은 자기 자신을 잡을 수 없다.',
  },
  {
    id: 'wit-race-overtake',
    category: '재치',
    question: '달리기에서 2등을 제치면 몇 등?',
    choices: ['1등', '2등', '3등', '꼴등'],
    correctIndex: 1,
    note: '제친 그 사람 자리(2등)를 차지할 뿐.',
  },
  {
    id: 'wit-candle-blow',
    category: '재치',
    question: '켜둔 양초 10개 중 3개가 바람에 꺼졌다. 다음 날 남은 건?',
    choices: ['7개', '10개', '3개', '0개'],
    correctIndex: 2,
    note: '꺼진 3개만 남고 나머지는 끝까지 타버린다.',
  },
  {
    id: 'wit-what-goes-up',
    category: '재치',
    question: '올라가기만 하고 절대 내려오지 않는 것은?',
    choices: ['연기', '나이', '풍선', '온도'],
    correctIndex: 1,
    note: '나이는 늘기만 한다.',
  },
  {
    id: 'wit-footprints',
    category: '재치',
    question: '가져갈수록 더 많이 남는 것은?',
    choices: ['돈', '발자국', '시간', '그림자'],
    correctIndex: 1,
    note: '걸을수록 발자국이 늘어난다.',
  },
  {
    id: 'wit-never-wither',
    category: '재치',
    question: '물을 주면 죽고, 안 주면 사는 것은?',
    choices: ['선인장', '조화', '불', '이끼'],
    correctIndex: 2,
    note: '불은 물에 꺼진다.',
  },
  {
    id: 'wit-sponge-holes',
    category: '재치',
    question: '구멍이 숭숭 뚫렸는데도 물을 머금는 것은?',
    choices: ['그물', '스펀지', '체', '빨대'],
    correctIndex: 1,
    note: '스펀지는 구멍이 많아도 물을 빨아들인다.',
  },
  {
    id: 'wit-birthday-twice',
    category: '재치',
    question: '한 해에 생일을 두 번 챙기는 사람도 있다. 어떻게?',
    choices: ['거짓말', '쌍둥이', '음력·양력', '윤년생'],
    correctIndex: 2,
    note: '음력 생일과 양력 생일을 둘 다 챙기면.',
  },

  // ── 상황추론 ──────────────────────────────────────────────────
  {
    id: 'logic-sheep-9',
    category: '상황추론',
    question: '양 17마리 중 9마리만 빼고 모두 죽었다. 남은 양은?',
    choices: ['8마리', '9마리', '17마리', '0마리'],
    correctIndex: 1,
    note: "'9마리만 빼고'이므로 그 9마리가 살아남았다.",
  },
  {
    id: 'logic-fire-first',
    category: '상황추론',
    question: '추운 방, 성냥 한 개비로 양초·난로·램프에 불을 붙이려면 뭐부터?',
    choices: ['양초', '난로', '성냥', '램프'],
    correctIndex: 2,
    note: '성냥에 먼저 불을 붙여야 나머지에 옮길 수 있다.',
  },
  {
    id: 'logic-green-house',
    category: '상황추론',
    question: '빨간 집은 빨간 벽돌, 노란 집은 노란 벽돌. 그린하우스는 뭘로 지을까?',
    choices: ['초록 벽돌', '유리', '잔디', '나무'],
    correctIndex: 1,
    note: '그린하우스 = 온실, 유리로 짓는다.',
  },
  {
    id: 'logic-dark-road',
    category: '상황추론',
    question: '불 꺼진 차가 검은 옷 입은 사람을 가로등도 없이 피했다. 어떻게?',
    choices: ['헤드라이트', '가로등', '대낮이라서', '달빛'],
    correctIndex: 2,
    note: '깜깜할 거란 건 착각 — 사실 환한 낮이었다.',
  },
  {
    id: 'logic-frog-well',
    category: '상황추론',
    question: '10m 우물 속 개구리가 낮에 3m 오르고 밤에 2m 미끄러진다. 며칠 만에 탈출?',
    choices: ['10일', '8일', '5일', '9일'],
    correctIndex: 1,
    note: '하루 1m씩, 8일째 낮에 3m 올라 한 번에 빠져나온다.',
  },
  {
    id: 'logic-three-gen-apple',
    category: '상황추론',
    question: '두 아버지와 두 아들이 사과를 하나씩 나눴는데 3개면 충분했다. 왜?',
    choices: ['반씩 잘라서', '세 사람뿐이라서', '한 명이 양보', '사실 4개'],
    correctIndex: 1,
    note: '할아버지·아버지·아들 3대 = 아버지 2명·아들 2명.',
  },
  {
    id: 'logic-doctor-mother',
    category: '상황추론',
    question: '의사가 "저 환자는 내 아들"이라는데 의사는 그 아이의 아버지가 아니다. 누구?',
    choices: ['삼촌', '어머니', '새아빠', '형'],
    correctIndex: 1,
    note: '의사는 그 아이의 어머니.',
  },
];

// id 사전순 정렬 — 추출 결정성을 풀의 삽입 순서와 분리한다(trivia와 동일 규약).
export const NONSENSE_POOL_SORTED: readonly NonsenseQuestion[] = [...NONSENSE_POOL].sort((a, b) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
);
