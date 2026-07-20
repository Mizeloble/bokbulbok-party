// 크레딧 식별자는 빌드 시 env로 주입 (사내 배포는 NEXT_PUBLIC_CREDIT_*로 덮어씀).
// 공개 repo 소스에는 일반 fallback만 둠 — 사내 이메일·조직명을 커밋하지 않기 위함.
const CREDIT_ORG = process.env.NEXT_PUBLIC_CREDIT_ORG || '복불복';
const CREDIT_AUTHOR_ENV = process.env.NEXT_PUBLIC_CREDIT_AUTHOR;
const CREDIT_AUTHOR = CREDIT_AUTHOR_ENV || 'Mizeloble';
const CREDIT_AUTHOR_URL_ENV = process.env.NEXT_PUBLIC_CREDIT_AUTHOR_URL;
// URL 명시 → 그 링크 / author만 주입(사내) → 링크 없는 텍스트 / 둘 다 미설정(공개) → GitHub.
const CREDIT_AUTHOR_URL =
  CREDIT_AUTHOR_URL_ENV
    ? CREDIT_AUTHOR_URL_ENV
    : CREDIT_AUTHOR_ENV
      ? ''
      : 'https://github.com/Mizeloble';

export const ko = {
  app: {
    title: '복불복',
    subtitle: '술자리·모임 벌칙, 폰으로 정하기',
    // 검색 결과용 타이틀 — 브랜드(title)와 분리. 검색 키워드(벌칙 정하기·파티게임) 포함.
    metaTitle: '복불복 — 술자리 벌칙 정하기 파티게임',
    metaDescription:
      '앱 설치 없이 폰으로 즐기는 벌칙 정하기 술게임. QR로 모여 마블 레이스·반응속도·퀴즈 한 판 — 술자리·MT·회식 복불복.',
  },
  landing: {
    createRoom: '방 만들기',
    creating: '생성 중…',
    description: 'QR을 찍어 모인 사람들끼리 게임으로 벌칙 정해요',
    createFailed: '방 생성에 실패했어요. 다시 시도해주세요.',
    busy: '지금 접속이 몰려요. 잠시 후 다시 시도해주세요',
    howTitle: '이렇게 즐겨요',
    steps: [
      '방을 만들면 QR 코드가 떠요',
      '친구들이 QR을 스캔해 바로 입장 (2~30명)',
      '미니게임 한 판으로 벌칙 당첨자 결정',
    ],
    gamesTitle: (n: number) => `미니게임 ${n}종`,
    installFree: '앱 설치 없이 폰 브라우저로',
    openSource: '오픈소스 · MIT',
    demoAlt: '미니게임 하이라이트 미리보기',
    // QR을 못 찍는 상황(카메라 없음·링크만 받음)을 위한 방 코드 직접 입력.
    joinByCodeTitle: '코드로 입장',
    joinByCodePlaceholder: '방 코드 (예: ABCD)',
    joinByCodeSubmit: '입장',
    joinByCodeInvalid: '방 코드를 확인해주세요',
    // 검색 유입용 FAQ — 랜딩 하단 노출 + FAQPage JSON-LD 동일 출처.
    faqTitle: '자주 묻는 질문',
    faq: [
      {
        q: '몇 명까지 할 수 있나요?',
        a: '2명부터 30명까지 한 방에서 즐길 수 있어요. 술자리·MT·회식 같은 4~12명 모임에 가장 잘 맞아요.',
      },
      {
        q: '앱을 설치해야 하나요?',
        a: '아니요. 폰 브라우저로 바로 열리는 웹 게임이라 설치도 회원가입도 없어요. QR만 찍으면 입장돼요.',
      },
      {
        q: '무료인가요?',
        a: '네, 전부 무료예요. 오픈소스(MIT)로 공개돼 있어요.',
      },
      {
        q: '어떤 게임으로 벌칙을 정하나요?',
        a: '마블 레이스, 반응속도, 상식·넌센스 퀴즈 등 미니게임 한 판으로 꼴찌를 뽑아요. 결과는 서버가 공정하게 결정해요.',
      },
      {
        q: '어떤 자리에서 쓰기 좋나요?',
        a: '벌칙 정하기·내기·복불복이 필요한 모든 모임 — 술자리, MT, 회식, 홈파티에서 쓰기 좋아요.',
      },
    ],
  },
  lobby: {
    waiting: '참가자를 기다리는 중',
    waitingHostPicking: '호스트가 게임을 고르는 중이에요. 같이 기다려요.',
    rosterSomeOffline: '일부 재접속 대기',
    rosterCount: (n: number) => `참가자 ${n}명`,
    invite: '초대하기',
    inviteShort: '초대',
    inviteScan: '옆자리 사람이 스캔하면 같은 방 입장',
    moreGamesComingSoon: '다른 게임 준비 중',
    copyLink: '링크 복사',
    share: '공유하기',
    linkCopied: '링크가 복사되었어요',
    chooseGame: '게임 선택',
    loserCount: '벌칙 받을 사람 수',
    loserCountUnit: (n: number) => `${n}명`,
    start: '시작',
    needMorePlayers: '2명 이상 모이면 시작할 수 있어요',
    nicknameBadge: (name: string) => `${name}(으)로 입장됨`,
    changeNickname: '바꾸기',
    comingSoon: '준비 중',
    meBadge: '나',
    cancel: '취소',
    roomLabel: '방',
    hostTag: '호스트',
    // 이전 호스트가 나가 자동으로 호스트 권한을 넘겨받았을 때 뜨는 안내.
    becameHost: '호스트가 나가서 내가 방장이 됐어요',
    addManualTitle: '직접 추가',
    addManualHint: '폰 없는 사람을 호스트가 대신 등록',
    addManualPlaceholder: '닉네임 입력',
    addManualSubmit: '추가',
    removeManualAria: (name: string) => `${name} 제거`,
    addManualErrors: {
      duplicate: '같은 닉네임이 이미 있어요',
      full: '방이 꽉 찼어요',
      badNick: '1~10자로 입력해주세요',
      badState: '게임 진행 중에는 추가할 수 없어요',
      generic: '추가할 수 없어요',
    },
  },
  join: {
    title: '닉네임 입력',
    placeholder: '예: 김철수',
    submit: '입장',
    submitting: '입장 중…',
    rules: '2~10자, 다른 참가자와 겹치지 않게',
    duplicate: '같은 닉네임이 이미 있어요',
  },
  game: {
    countdown: '시작!',
    countdownGoSub: 'go go go',
    countdownPreSub: '곧 시작',
    inProgress: '이미 게임 진행 중이에요',
    myRankFirst: '🥇 1등 골인!',
    myRankLast: '🎯 오늘은 내가 벌칙!',
    myRankMid: (rank: number) => `${rank}등 골인!`,
    myRankSubFirst: '운 좋게 면제!',
    myRankSubLast: '벌칙 당첨 🎯',
    myRankSubMid: (total: number) => `총 ${total}명 중`,
    loserRevealed: (name: string) => name,
    loserRevealedBadge: '꼴찌 결정!',
    loserRevealedSub: '오늘 벌칙은 당신!',
  },
  result: {
    losers: (n: number) => `오늘 벌칙은 ${n}명!`,
    headerChip: '오늘의 벌칙',
    countBadge: (n: number) => `× ${n}명`,
    loserBadge: '패자',
    again: '다시 하기',
    changeGame: '게임 바꾸기',
    closeRoom: '방 닫기',
    leaveRoom: '방 나가기',
    youLost: '오늘은 내가 벌칙 🎯',
    youWon: '운 좋게 면제!',
    tapToContinue: '결과 보기',
    fullRanking: '전체 순위',
    fullRankingShow: '전체 순위 보기',
    fullRankingHide: '순위 숨기기',
    invite: '친구 부르기',
    waitingNext: '호스트가 다음 라운드를 준비 중',
    waitingNextLong: '호스트가 다음 라운드를 시작할 거예요',
    replay: '다시 보기',
    rank: (n: number) => `${n}등`,
  },
  errors: {
    generic: '문제가 생겼어요',
    connecting: '연결 중…',
    reconnecting: '연결이 끊겼어요 · 다시 연결 중…',
    reconnectRetry: '새로고침',
    serverRestarting: '서버 업데이트 중 · 곧 다시 연결돼요',
    offline: '인터넷 연결이 끊겼어요',
    backToHome: '처음으로',
    roomNotFound: '방을 찾을 수 없어요',
    raceInProgress: '이미 진행 중인 게임이 있어요',
    full: '방이 꽉 찼어요',
    inProgress: '이미 진행 중이에요',
    badNick: '닉네임을 확인해주세요',
    duplicateNick: '같은 닉네임이 이미 있어요',
    notHost: '호스트만 가능해요',
    badStateAdd: '게임 진행 중에는 추가할 수 없어요',
    badStateChange: '게임 진행 중에는 변경할 수 없어요',
    noPlayer: '참가자를 찾을 수 없어요',
    notManual: '직접 추가한 참가자만 제거할 수 있어요',
  },
  invite: {
    shareText: '같이 벌칙 정하기 하실래요?',
    close: '닫기',
    copied: '복사됨 ✓',
  },
  // 결과 화면 → 단톡방으로 들고 나가는 공유 카드(클라이언트 캔버스 렌더).
  share: {
    button: '결과 공유',
    preparing: '준비 중…',
    saved: '이미지 저장됨 ✓',
    failed: '공유 실패 · 다시 시도',
    cardSub: '오늘 벌칙 당첨 🎯',
    shareText: '복불복에서 오늘의 벌칙을 정했어요 🎯',
  },
  games: {
    marble: '마블 레이스',
    'marble-cheer': '응원 마블 레이스',
    'marble-tilt': '기울임 마블',
    slot: '슬롯머신 룰렛',
    elimination: '탈락 룰렛',
    reaction: '동시탭 반응속도',
    trivia: '일반 상식',
    nonsense: '넌센스 퀴즈',
    physicsEstimate: (s: number) => `~${s}초 · 물리 기반`,
    cheerEstimate: (s: number) => `~${s}초 · 응원 충전`,
    tiltEstimate: (s: number) => `~${s}초 · 자이로 조작`,
    reactionEstimate: (s: number) => `~${s}초 · 반응 속도`,
    triviaEstimate: (s: number) => `~${s}초 · 상식 퀴즈`,
    nonsenseEstimate: (s: number) => `~${s}초 · 넌센스 퀴즈`,
    secEstimate: (s: number) => `~${s}초`,
  },
  // 로비 게임 카드의 한 줄 소개("뭐 하는 게임인지 + 벌칙 조건"). 상세 규칙은 gameIntros.
  gameDesc: {
    marble: '구슬이 굴러 내려가 꼴찌가 벌칙',
    'marble-cheer': '응원 탭으로 충전한 뒤 레이스',
    'marble-tilt': '폰을 기울여 구슬 조종, 꼴찌 벌칙',
    slot: '이름이 슬롯처럼 돌다 멈춘 자리 벌칙',
    elimination: '룰렛이 한 명씩 지목, 끝까지 생존',
    reaction: '신호에 가장 늦게 탭하면 벌칙',
    trivia: '상식 4지선다, 점수 낮으면 벌칙',
    nonsense: '넌센스 4지선다, 점수 낮으면 벌칙',
  },
  gameIntros: {
    marble: [
      '핀이 빼곡한 트랙을 따라 구슬들이 굴러 내려가요',
      '꼴찌 N명이 벌칙을 받아요',
      '결과는 운만 — 가만히 응원만 해요',
    ],
    'marble-cheer': [
      '시작 전 5초간 화면을 미친듯이 탭하면 충전돼요',
      '응원 받은 구슬은 더 앞에서 출발해요',
      '작고 무거워져서 핀 사이를 잘 빠져나가요',
      '꼴찌 N명이 벌칙을 받아요',
    ],
    slot: [
      '이름들이 슬롯처럼 다다닥 돌다 멈춰요',
      '멈춘 자리가 패자',
    ],
    elimination: [
      '원형 룰렛이 한 명씩 지목해 탈락',
      '마지막까지 남으면 살아남아요',
    ],
    reaction: [
      '"지금!" 신호가 뜨면 가장 빨리 탭',
      '느린 N명이 벌칙',
      '미리 누르면 가장 일찍 누른 순서로 꼴등',
    ],
    trivia: [
      '4지선다 5문제',
      '빠르게 맞힐수록 점수↑ · 연속 정답 콤보 보너스',
      '마지막 문제는 점수 2배 — 끝까지 역전 가능',
      '점수 낮은 N명이 벌칙',
    ],
    nonsense: [
      '4지선다 5문제 · 말장난과 재치 문제',
      '빠르게 맞힐수록 점수↑ · 연속 정답 콤보 보너스',
      '마지막 문제는 점수 2배 — 끝까지 역전 가능',
      '점수 낮은 N명이 벌칙',
    ],
    'marble-tilt': [
      '폰을 좌우로 기울이면 내 구슬에 힘이 가해져요',
      '오른쪽 아래 부스트 버튼을 탭하면 골 방향으로 한 번에 튀어나가요 (3회)',
      '안드로이드는 자동, 아이폰은 권한 허용 한 번만',
      '꼴찌 N명이 벌칙을 받아요',
    ],
  },
  // 검색 유입용 게임 소개 페이지(/games/<id>). 규칙 목록은 gameIntros 재사용,
  // 여기엔 페이지 고유 문구(키워드 포함 소개 문단·메타)만.
  gamePages: {
    rulesTitle: '게임 방법',
    howToTitle: '시작하는 법',
    cta: '지금 방 만들기',
    otherTitle: '다른 미니게임',
    intro: {
      marble: '구슬이 핀 트랙을 굴러 내려가는 운빨 100% 복불복 레이스. 조작이 없어 누구나 공평하게 벌칙을 정할 수 있어요.',
      'marble-cheer':
        '시작 전 5초 동안 화면을 탭해 내 구슬을 응원하는 마블 레이스. 응원한 만큼 유리해지지만 결과는 끝까지 몰라요.',
      'marble-tilt':
        '폰을 기울여 내 구슬을 직접 조종하는 실시간 레이스. 실력과 운이 반반 섞인 벌칙 정하기 게임이에요.',
      reaction:
        '신호에 맞춰 가장 빨리 탭하는 반응속도 대결. 제일 느린 사람이 벌칙 — 한 판에 몇 초면 끝나요.',
      trivia:
        '4지선다 상식 퀴즈 5문제로 점수를 겨뤄요. 빠르게 맞힐수록 점수가 높고, 꼴찌가 벌칙이에요.',
      nonsense:
        '말장난과 재치로 푸는 넌센스 퀴즈 5문제. 상식보다 순발력 — 점수 낮은 사람이 벌칙이에요.',
    },
  },
  charge: {
    /** Lobby GameIntro badge for pre-charge games (no trailing "!"). */
    badge: '응원 충전',
    title: '응원 충전!',
    subtitle: '5초 안에 미친듯이 탭하세요',
    tapHint: '탭!',
    secondsLeft: (s: number) => `${s}초`,
    myGauge: '내 응원',
    avgGauge: '전체 평균',
    manualNote: '폰 없는 참가자는 평균값으로 자동 충전돼요',
    starting: '시작!',
  },
  marble: {
    paneLoserView: '🎯 꼴찌 시점',
    paneFinishedLoserView: '✓ 도착 · 🎯 꼴찌 시점',
    paneRiskCandidate: '⚠️ 위험! 꼴찌 후보',
    paneMyView: '👁 내 시점',
    loserExclamation: '🎯 꼴찌!',
    loserConfirmedBadge: '꼴찌 결정!',
  },
  marbleTilt: {
    permEnable: '기울임 조작 활성화',
    permRequesting: '권한 요청 중…',
    permReady: '✓ 기울임 준비됨',
    permDenied: '권한이 거부되어 자동 진행돼요',
    permRetry: '다시 시도',
    permUnsupported: '이 기기는 기울임을 지원하지 않아요',
    hint: '폰을 좌우로 기울여 내 구슬을 조작',
    hostNotice: '참가자만 자이로 조작이 활성화돼요',
    boostButton: '부스트',
    boostLabel: '부스트',
  },
  reaction: {
    ready: '준비…',
    readySub: '노란불에 탭!',
    go: '지금!',
    goSub: '탭!',
    falseStart: '너무 빨라요!',
    falseStartLockedTitle: '출발 위반 · 결과 대기',
    falseStartLockedRule: '더 일찍 누른 사람이 있으면 꼴등을 면할 수 있어요',
    tabulating: '결과 집계 중…',
    myTime: (ms: number) => `${ms}ms`,
    tapHint: '여기를 탭',
    waitingTap: '탭 안 했어요',
    youTapped: '기록됨',
    resultMs: (ms: number) => `${ms}ms`,
    resultFalseStart: (ms: number) => `−${Math.abs(ms)}ms · 위반`,
    resultNoTap: '미탭',
  },
  trivia: {
    questionLabel: (n: number, total: number) => `${n}/${total}`,
    timeLeft: (s: number) => `${s}초`,
    answered: '제출됨',
    correctReveal: '정답!',
    wrongReveal: '오답',
    noAnswer: '미응답',
    yourScore: (n: number) => `${n.toLocaleString()}점`,
    scoreLabel: '내 점수',
    finalTabulating: '결과 집계 중…',
    startingTitle: '곧 시작합니다',
    startingSub: (count: number) => `${count}문제 · 빠를수록 점수↑`,
    startingCountdown: (s: number) => (s > 0 ? `${s}` : '시작!'),
    scoreToastGain: (n: number) => `+${n.toLocaleString()}`,
    comboBadge: (n: number) => `🔥 ${n} COMBO!`,
    lastQuestionBadge: '마지막 · 점수 2배',
    midRankTitle: '현재 순위',
    rankPos: (n: number) => `${n}위`,
    detailToggle: '특이점만 모아보기',
    detailHide: '접기',
    detailMyAnswer: '내 답',
    detailCorrect: '정답',
    detailWrong: '오답',
    detailNoAnswer: '미응답',
    detailNoteLabel: '💡',
    detailQuestionNum: (n: number) => `Q${n}`,
    detailHighlightHits: (right: number, total: number) => `${right}/${total} 정답`,
    detailAllRight: '모두 정답!',
    detailAllWrong: '모두 오답…',
    detailAllNone: '모두 미응답',
    detailAllNoneSummary: (n: number) => `${n}문제 모두 미응답`,
    detailNobodyAnswered: '아무도 못 맞힘',
    detailSkippedSummary: (allRight: number, allWrong: number) => {
      if (allRight && allWrong) return `+ ${allRight}문제 모두 정답 · ${allWrong}문제 모두 오답`;
      if (allRight) return `+ ${allRight}문제는 모두 정답`;
      if (allWrong) return `+ ${allWrong}문제는 모두 오답`;
      return '';
    },
    detailNoOutliers: '딱히 놀릴 만한 결과가 없어요 — 다들 비슷하게 풀었음.',
  },
  dev: {
    botNames: ['봇1', '봇2', '봇3', '봇4', '봇5'] as const,
  },
  ads: {
    label: '광고',
  },
  consent: {
    title: '맞춤 광고 동의',
    desc: '서버 운영비를 위해 광고를 표시해요. 동의하면 더 관련성 높은 맞춤 광고가 보여요.',
    accept: '동의',
    decline: '비맞춤 광고만',
    privacyLink: '개인정보 처리방침',
  },
  legal: {
    privacy: '개인정보 처리방침',
    terms: '이용약관',
    feedback: '의견 보내기',
    backHome: '처음으로',
    updated: (d: string) => `최종 업데이트 ${d}`,
  },
  privacy: {
    title: '개인정보 처리방침',
    updatedAt: '2026-06-07',
    sections: [
      {
        h: '수집하는 정보',
        body: '계정·로그인이 없어요. 입력한 닉네임은 게임이 진행되는 동안 서버 메모리에만 임시로 두고, 방이 끝나거나 일정 시간 비면 삭제돼요. 데이터베이스나 영속 저장소는 사용하지 않아요.',
      },
      {
        h: '쿠키·로컬 저장소',
        body: '광고 동의 여부와 닉네임은 이 기기의 브라우저 저장소(localStorage)에, 방 참여 토큰은 세션 저장소(sessionStorage)에 보관돼요. 추적용 영구 쿠키는 직접 심지 않아요.',
      },
      {
        h: '광고',
        body: '서버 운영비 충당을 위해 카카오 애드핏 또는 구글 애드센스 광고를 표시할 수 있어요. 광고 제공사는 광고 송출을 위해 쿠키나 기기 식별자를 사용할 수 있고, 맞춤 광고는 동의하신 경우에만 적용돼요. 언제든 브라우저 저장소를 비우면 선택을 초기화할 수 있어요.',
      },
      {
        h: '분석',
        body: '서비스 개선을 위해 익명 집계 형태의 방문 분석 도구를 사용할 수 있어요. 개인을 식별하는 정보는 수집하지 않아요.',
      },
      {
        h: '제3자 제공',
        body: '위 광고·분석 제공사 외에 어떤 데이터도 판매하거나 공유하지 않아요.',
      },
      {
        h: '문의',
        body: '문의는 GitHub 저장소 이슈로 남겨주세요.',
      },
    ],
  },
  terms: {
    title: '이용약관',
    updatedAt: '2026-06-07',
    sections: [
      {
        h: '서비스 성격',
        body: '이 서비스는 친구·동료끼리 벌칙을 정하는 무료 오락용 웹앱이에요. MIT 라이선스 오픈소스로 제공돼요.',
      },
      {
        h: '보증의 부인',
        body: '서비스는 "있는 그대로" 제공되며, 가용성·정확성·중단 없는 이용을 보장하지 않아요. 게임 결과는 오락 목적이며 이용에 따른 책임은 이용자에게 있어요.',
      },
      {
        h: '이용자 행위',
        body: '불법 행위, 타인 괴롭힘, 부적절한 닉네임 사용을 금지해요. 위반 시 이용이 제한될 수 있어요.',
      },
      {
        h: '약관 변경',
        body: '약관은 사전 고지 없이 변경될 수 있으며, 변경 후 계속 이용하면 변경에 동의한 것으로 간주돼요.',
      },
    ],
  },
  credit: {
    org: CREDIT_ORG,
    authorHandle: CREDIT_AUTHOR,
    authorUrl: CREDIT_AUTHOR_URL,
    repoLabel: 'GitHub',
    repoUrl: 'https://github.com/Mizeloble/bokbulbok-party/',
    version: (v: string) => `v${v}`,
  },
} as const;

export type Strings = typeof ko;
