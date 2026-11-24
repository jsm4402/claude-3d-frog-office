"use strict";
// 화면 문구·대사 — 한국어(ko)·영어(en).
// 언어 = 주소의 ?lang= > 저장해 둔 선택(localStorage office.lang) > /api/config 의 lang(auto 가 아니면)
//      > 브라우저 언어(ko 로 시작하면 ko, 아니면 en).

const I18N = (() => {
  const STORE = "office.lang";

  const TEXT = {
    ko: {
      title: "3D 사무실",
      "lang.label": "언어",
      "side.people": "사무실 사람들",
      "side.log": "활동 로그",
      "side.hint": "캐릭터나 이름을 누르면 자세히 봅니다",
      "canvas.label": "사무실 — 캐릭터를 누르면 오른쪽 목록에서 자세히 봅니다",
      sum: "일하는 중 {w} · 승인 대기 {d} · 쉬는 중 {r}",
      "sum.subs": " · 서브에이전트 {n}",
      count: "{n}명 · 일하는 중 {w}",
      demo: "데모 데이터",
      "note.loading": "사무실 불 켜는 중…",
      "note.img": "사무실 그림을 불러오지 못했습니다 — 새로고침해 보세요",
      "note.net": "로컬 서버에 연결하지 못했습니다 — 잠시 뒤 다시 읽습니다",
      "note.empty": "켜진 Claude 세션이 없습니다 — 아무 폴더에서 claude 를 실행하면 사무실로 출근합니다",
      "note.hooks": "훅 미설치 — 대화 기록만으로 표시 중(승인 대기는 감지 안 됨)",
      "status.decision": "승인 대기", "status.working": "일하는 중", "status.rest": "쉬는 중",
      "chip.subs": "서브에이전트 {n}",
      needs: "승인 대기",
      "ask.tool": "{a} 사용 승인 대기",
      "ask.input": "입력 대기",
      "doing.subs": "서브에이전트에게 일을 맡겨 둠",
      "doing.work": "일하는 중…",
      "d.now": "지금", "d.path": "경로", "d.sessions": "세션 {n}개", "d.commits": "커밋 {n}",
      "d.transcript": "대화 기록으로 감지", "d.pending": "승인 대기 {n}건", "d.subs": "서브에이전트",
      "d.more": "외 {n}명", "d.idle": "지금은 쉬는 중", "d.subIdle": "대기 중",
      "ev.in": "출근했습니다", "ev.out": "퇴근했습니다", "ev.work": "일을 시작했습니다",
      "ev.ask": "승인을 기다립니다 — {a}", "ev.subwork": "서브에이전트와 일하는 중", "ev.done": "일을 마쳤습니다",
      "ev.subIn": "서브에이전트 출근 — {a}", "ev.subOut": "서브에이전트 퇴근 — {a}",
      "ev.check": "확인 필요", "ev.task": "일 받음", "ev.end": "일 끝",
    },
    en: {
      title: "3D Office",
      "lang.label": "Language",
      "side.people": "People in the office",
      "side.log": "Activity",
      "side.hint": "Click a character or a name for details",
      "canvas.label": "Office — click a character to see details in the list on the right",
      sum: "Working {w} · Needs you {d} · Idle {r}",
      "sum.subs": " · Subagents {n}",
      count: "{n} · {w} working",
      demo: "Demo data",
      "note.loading": "Turning on the lights…",
      "note.img": "Couldn't load the office images — try reloading",
      "note.net": "Can't reach the local server — retrying shortly",
      "note.empty": "No Claude sessions running — run claude in any folder and it shows up for work",
      "note.hooks": "Hooks not installed — showing transcripts only (approval waits aren't detected)",
      "status.decision": "Needs you", "status.working": "Working", "status.rest": "Idle",
      "chip.subs": "{n} subagent(s)",
      needs: "Needs you",
      "ask.tool": "Allow {a}?",
      "ask.input": "Needs your input",
      "doing.subs": "Subagents are on it",
      "doing.work": "Working…",
      "d.now": "Now", "d.path": "Path", "d.sessions": "{n} session(s)", "d.commits": "{n} commits",
      "d.transcript": "Detected from transcript", "d.pending": "{n} waiting for approval", "d.subs": "Subagents",
      "d.more": "+{n} more", "d.idle": "Taking a break", "d.subIdle": "Standing by",
      "ev.in": "Clocked in", "ev.out": "Clocked out", "ev.work": "Started working",
      "ev.ask": "Needs you — {a}", "ev.subwork": "Working with subagents", "ev.done": "Finished",
      "ev.subIn": "Subagent joined — {a}", "ev.subOut": "Subagent done — {a}",
      "ev.check": "check needed", "ev.task": "new task", "ev.end": "done",
    },
  };

  // 활동(Act) 한 줄 — {k, a}. CONTRACT 4절 표의 k 목록.
  const ACT = {
    ko: {
      text: "💬 {a}", read: "📖 {a} 읽는 중", edit: "✏️ {a} 고치는 중", write: "📝 {a} 쓰는 중", bash: "🔧 {a}",
      grep: "🔍 '{a}' 찾는 중", glob: "🔍 {a} 파일 찾는 중", fetch: "🌐 {a} 읽는 중", search: "🌐 '{a}' 검색 중",
      agent: "🐣 서브에이전트에게 맡김: {a}", todo: "🗒️ 할 일 정리 중", skill: "📚 {a} 펼치는 중",
      mcp: "🔌 {a} 쓰는 중", tool: "⚙️ {a} 쓰는 중",
    },
    en: {
      text: "💬 {a}", read: "📖 Reading {a}", edit: "✏️ Editing {a}", write: "📝 Writing {a}", bash: "🔧 {a}",
      grep: "🔍 Searching '{a}'", glob: "🔍 Finding files {a}", fetch: "🌐 Reading {a}", search: "🌐 Searching '{a}'",
      agent: "🐣 Delegated: {a}", todo: "🗒️ Updating the to-do list", skill: "📚 Opening skill {a}",
      mcp: "🔌 Using {a}", tool: "⚙️ Using {a}",
    },
  };
  // 인자가 비었을 때 대신 넣는 말
  const ACT_EMPTY = {
    ko: { read: "파일", edit: "파일", write: "파일", fetch: "웹", bash: "명령 실행 중", agent: "일", tool: "도구", mcp: "도구" },
    en: { read: "a file", edit: "a file", write: "a file", fetch: "the web", bash: "Running a command", agent: "a task",
          tool: "a tool", mcp: "a tool" },
  };

  // 대사 — 말풍선 한 줄. 수다는 주고받는 맛이 나게 묻고 답하는 말을 섞는다.
  const LINES = {
    ko: {
      convo: ["커피 한 잔 할래?|나 어제 세 잔 마셨는데|그럼 오늘은 네 잔 가자ㅋㅋ", "빌드 됐어?|응 됐어|진짜? 거짓말…|아니 진짜야 로그 봐봐|오 진짜네 천재", "점심 뭐 먹지|김치찌개?|어제도 먹었잖아|그럼 어제랑 다른 김치찌개로 가자ㅋㅋ", "깃 충돌 났어…|누가 건드렸어?|…나야|아 뭐야ㅋㅋㅋ", "테스트 다 통과!|와 처음이다|처음은 아니야|처음이야 솔직히", "배포는 내일 하자|오늘 하면 안 돼?|금요일 오후잖아|…내일 하자", "그 파일 누가 지웠어?|git 보면 나오는데|보지 마… 내가 지웠어|ㅋㅋㅋㅋ", "토큰 아껴 써야지|너 방금 두 번 물어봤잖아|그건 투자였어|투자 수익률이 궁금하다", "퇴근 몇 시야?|아직 멀었지|시계가 고장난 것 같아|아니 정상이야…", "주말에 뭐 해?|코딩|그건 평일이랑 같잖아ㅋㅋ|그래서 쉬는 거야", "버그 잡았다!|어디 있었어?|세미콜론이 숨어 있었어|걔는 맨날 숨더라", "회의 언제야?|3시|무슨 회의인데?|…그건 모르겠다ㅋㅋ", "나 방금 천재 같았어|뭐 했는데?|변수 이름 바꿨어|그게 제일 어려워", "졸려…|커피 마셔|이미 마셨어|그럼 낮잠이다", "이거 로컬에선 되는데|그럼 로컬로 배포하자|고객님은 내 책상으로 오시라고?|ㅋㅋㅋ 가능", "점심 뭐 먹을까|아무거나|아무거나는 메뉴에 없어|그럼 메뉴판을 새로 쓰자", "이 코드 누가 짰어?|왜, 별로야?|아니 너무 잘 짰는데 이해가 안 돼|…그럼 내가 짠 거 맞네", "방금 저장했어?|응|Ctrl+S 눌렀어?|…눌렀다고 생각해", "오늘 커밋 몇 개 했어?|세 개|메시지는?|fix, fix2, fix 진짜 마지막", "회의 또 있어?|응 3시에|이 회의 메일로 대체 안 돼?|메일로 보내도 회의 잡을 거야", "와이파이 안 돼|껐다 켜봤어?|껐다 켜는 건 내 전문인데|그럼 너도 껐다 켜봐ㅋㅋ", "어제 꿈에서 배포했어|어땠어?|롤백했어|꿈에서도 롤백이냐ㅋㅋㅋ", "나 오늘 일찍 퇴근할 거야|몇 시에?|6시 1분|1분 일찍은 인정", "커피 머신 또 고장났어|누가 건드렸어?|난 버튼만 눌렀어|그게 건드린 거야", "이거 어떻게 하는 거야?|검색해봐|검색했는데 네가 쓴 글이 나왔어|…그럼 내가 알겠네", "점심시간 아직 멀었나|11시 40분이야|10분만 일찍 가자|그 말 어제도 했어", "이 에러 처음 보는데|스택 트레이스 봐봐|읽어도 모르겠어|그건 외계어야", "내 차례야?|아니 네 차례 아니야|그럼 누구 차례야?|…아무도 안 하고 있네ㅋㅋ", "방금 소리 들었어?|무슨 소리?|서버가 한숨 쉬는 소리|서버는 원래 한숨 쉬어", "파일 이름 뭐로 하지|final|final2도 있는데|final_진짜최종은 어때?", "나 오늘 하루종일 앉아만 있었어|나도|우리 스트레칭 할래?|…내일 하자", "이 버튼 눌러도 돼?|뭐가 일어날지는 몰라|그럼 누르지 마|이미 눌렀어", "테스트가 갑자기 통과했어|좋은 거 아냐?|아무것도 안 고쳤는데?|그게 제일 무서워", "누가 내 커피 마셨어?|이름 쓰여 있었어?|아니|그럼 공용이었던 거야", "이번 주 목표가 뭐였지|살아남기|그건 지난주 목표잖아|이번 주도 유효해", "나 방금 변수 이름 바꿨어|잘했네|근데 다 깨졌어|역시 이름이 중요해", "디자인 시안 봤어?|응|어때?|로고를 좀 더 크게|항상 그 말 하더라ㅋㅋ", "이 회의 필요해?|필요 없을걸|근데 왜 들어가?|참석자 수가 중요하대", "마감이 언제야?|어제|그럼 지금은?|…오늘의 어제야", "오늘 날씨 좋다|창문 없어서 모르겠는데|그럼 상상해봐|좋다ㅋㅋ", "너 키보드 소리 너무 커|이게 생산성 소리야|옆자리는 괴로워|그럼 헤드폰 써", "나 방금 큰 깨달음 얻었어|뭔데?|재부팅하면 돼|…깨달음이 너무 작은데", "누가 여기 에어컨 껐어?|더워?|아니 추워서|그럼 왜 켜달라고 해ㅋㅋ", "이거 문서에 있어?|있을걸|어디에?|…있을걸 이라고만 했어", "지금 몇 시야?|2시 반|벌써?|아니 이제 겨우|시간 개념이 없어ㅋㅋ", "어제 그 드라마 봤어?|아니|나도 안 봤어|근데 왜 물어봤어ㅋㅋ", "이 줄 지워도 돼?|왜 있는지는 알아?|아니|그럼 지우지 마 무서워", "배고프다|아까 먹었잖아|그건 아까고|아까와 지금은 다른 위장이야", "오늘 몇 퍼센트 했어?|30퍼|내 기준엔 90퍼야|기준이 없구나ㅋㅋ", "회식 언제야?|이번 주 금요일|메뉴는?|고기|그럼 간다", "리팩터링 하고 싶다|뭘 고칠 건데?|전부|그건 리팩터링이 아니라 재창조야", "이거 버그야 기능이야?|뭐라고 부르고 싶어?|기능|그럼 기능으로 하자ㅋㅋ", "내 마우스 어디 갔지|손에 쥐고 있는데|…아|ㅋㅋㅋ 가끔 그래", "출근 도장 찍었어?|아니|지금 12시야|점심 도장이라도 찍어", "이거 어제는 됐는데|어제는 어제고|오늘은?|오늘은 오늘의 사정이 있대", "이 일 끝나면 뭐 해?|퇴근|그다음엔?|퇴근 후 퇴근", "업무 정리했어?|응|어떻게?|새 폴더 만들어서 다 넣었어|이름은?|새 폴더 (3)", "내 이름이 왜 여기 있어?|네가 담당이래|언제 정해진 거야?|네가 자리 비웠을 때", "오 점심 메뉴 정했어|뭐야?|국밥|좋은 선택이야|내 인생의 유일한 결정이야", "팀장님 오시나?|아직|올 때 알려줘|지금 오고 계셔|왜 이제 말해!", "이 폴더 뭐야?|옛날 거래|지워도 돼?|…그건 역사야", "소리 좀 줄여줘|뭐가 크지?|네 한숨 소리|그건 내 BGM이야", "나 방금 칭찬받았어|누구한테?|코드한테|…코드가 칭찬을 해?|컴파일 에러가 안 났어", "자리 바꿨어?|아니|근데 뭔가 달라졌는데|네 의자가 내려갔어", "이거 급한 거야?|다 급하대|그럼 뭐부터 해?|급한 것 중에 덜 급한 것", "비밀번호 뭐였지|저번에 바꿨잖아|뭐로?|…그게 비밀번호야", "내가 방금 뭐 하려고 했더라|일어나서 왔잖아|그러니까 뭐 하러|…물 마시러 왔나", "이 파일 용량 왜 이래|사진 넣었지?|아니|그럼 고양이 사진은?|…그건 넣었지", "점심 같이 갈래?|누구랑?|너랑|오 영광인데|그럼 네가 사", "전화 왔어|누구야?|모르는 번호|그럼 받지 마|이미 받았어", "나 오늘 천재인 듯|왜?|아침에 일어난 게 제일 잘한 일|그게 천재지", "이거 고객한테 보내도 돼?|한 번만 더 읽어봐|읽었어|오타 있어|…어디|ㅋㅋㅋ 여기"],
      talk: ["커피 한 잔 할래?", "빌드 됐어?", "테스트 다 통과!", "깃 충돌 났어…", "리뷰 좀 부탁해", "점심 뭐 먹지",
             "배포는 내일 하자", "토큰 아껴 써야지", "버그 하나 잡았다", "그거 커밋했어?", "ㅋㅋㅋㅋ", "승인 좀 눌러줘",
             "회의 언제야?", "로그 봤어?", "오늘 일 많네", "서버 괜찮아?", "PR 올렸어", "새로고침 해봐",
             "됐다 됐다!", "그거 내가 할게", "오 진짜?", "대박ㅋㅋ", "아 맞다", "그건 좀…", "천재인데?",
             "주말에 뭐 해?", "고양이 사진 볼래?", "어제 그 영상 봤어?", "다이어트는 내일부터", "졸려…"],
      phone: ["여보세요~", "지금 확인할게요", "네네 바로요", "아 그거요?", "네, 말씀하세요"],
      scroll: ["📱 쇼츠 하나만…", "📱 뉴스 보는 중", "알림 왔네", "📱 고양이 영상", "오 이거 괜찮네", "📱 맛집 검색"],
      texting: ["답장 중…", "📱 톡톡", "ㅇㅋㅇㅋ", "지금 가는 중~", "단톡 폭발"],
      lol: ["ㅋㅋㅋㅋ", "아 웃겨ㅋㅋ", "이거 봐ㅋㅋ", "ㅋㅋ 미쳤다"],
      think: ["배고프다…", "커피 땡긴다", "오늘 칼퇴 가능?", "음…", "뭐 하더라", "♪~", "졸려"],
      greet: ["안녕!", "하이~", "수고해!", "좋은 아침~", "오 왔어?"],
      work: ["타닥타닥…", "코드 짜는 중", "생각 중…", "확인 중…"],
      rack: ["🖥️ 랙 불빛 이상 무", "서버 온도 좋고", "백업 확인"],
      rackOk: ["🖥️ 랙 불빛 이상 무"],
      brew: ["☕ 커피 내리는 중"],
      sip: ["캬~", "아 좋다", "☕ 후루룩"],
      reading: ["📚 읽는 중"],
      stretch: ["으아아~"],
      meeting: ["자, 회의 시작합니다"],
      bye: ["또 봐~", "고고!", "ㅂㅂ", "나중에 봐"],
      cheer: ["됐다!", "통과!", "오예~"],
      askWave: ["여기요~!", "확인 부탁해요!", "승인해 주세요~"],
      miniIn: ["출근!", "넵!", "왔습니다"],
      miniBye: ["퇴근합니다! 👋"],
      miniIdle: ["넵!", "확인 중…", "보고드립니다", "뭐 하지?"],
    },
    en: {
      convo: ["Coffee?|I had three already|Make it four lol", "Build passed?|Yep|Liar…|Check the logs!|Wow, it did", "Lunch?|Kimchi stew?|We had it yesterday|Then a different kimchi stew lol", "Merge conflict…|Who touched it?|…me|Seriously?! lol", "All tests green!|First time ever|Not the first|Okay, the first", "Ship it tomorrow|Why not today?|It's Friday afternoon|…tomorrow then", "Who deleted that file?|Git blame knows|Don't look… it was me|lol", "Works on my machine|Then ship my machine|Customers come to my desk?|Fine, deal", "What should we eat?|Anything|Anything isn't on the menu|Then let's rewrite the menu", "Who wrote this code?|Why, is it bad?|No, it's great but I can't read it|Then I definitely wrote it", "Did you save?|Yeah|Did you press Ctrl+S?|…I believe I did", "How many commits today?|Three|Messages?|fix, fix2, fix really final", "Another meeting?|At 3|Can't this be an email?|They'd schedule a meeting about the email", "Wifi is down|Tried turning it off and on?|That's my specialty|Then turn yourself off and on lol", "I deployed in my dream last night|How was it?|Rolled back|Even your dreams roll back lol", "Coffee machine broke again|Who touched it?|I only pressed the button|That's touching it", "This error is new|Read the stack trace|Can't make sense of it|It's alien language", "Test suddenly passed|Isn't that good?|I changed nothing|That's the scary part", "What's the goal this week?|Survive|That was last week's goal|Still valid", "Can I delete this line?|Do you know why it's there?|No|Then don't, it's scary", "Is it a bug or a feature?|What do you want to call it?|Feature|Feature it is lol", "Where's my mouse?|In your hand|…oh|Happens to everyone", "What did you do with the folder?|Made a new one|Name?|New folder (3)", "Who's got the deadline?|Yesterday|And now?|Yesterday's today", "What was my password?|You changed it|To what?|…that's the password", "I got praised today|By whom?|The compiler|It said nothing|Exactly, praise", "Lunch together?|With whom?|You|I'm honored|Then you pay", "Can we send this to the client?|Read it once more|Done|Typo|…where|lol here"],
      talk: ["Coffee?", "Did the build pass?", "All tests green!", "Merge conflict…", "Can you review this?", "Lunch?",
             "Ship it tomorrow", "Save some tokens", "Squashed a bug", "Did you commit that?", "lol", "Approve my PR?",
             "When's the meeting?", "Seen the logs?", "Busy day", "Server OK?", "PR is up", "Try a refresh",
             "It works!", "I'll take that", "Oh really?", "haha nice", "Oh right", "Hmm, not sure…", "Genius!",
             "Weekend plans?", "Wanna see a cat pic?", "Saw that video?", "Diet starts tomorrow", "Sleepy…"],
      phone: ["Hello~", "Checking now", "Yep, on it", "Oh, that one?", "Go ahead"],
      scroll: ["📱 One more short…", "📱 Reading news", "Got a ping", "📱 Cat videos", "Oh, this is nice", "📱 Food spots"],
      texting: ["Replying…", "📱 tap tap", "ok ok", "On my way~", "Group chat is wild"],
      lol: ["lol", "haha so funny", "look at this lol", "lmao"],
      think: ["Hungry…", "Need coffee", "Leave on time today?", "Hmm…", "What was I doing", "♪~", "Sleepy"],
      greet: ["Hi!", "Hey~", "Keep it up!", "Morning~", "Oh, you're here?"],
      work: ["tap tap tap…", "Writing code", "Thinking…", "Checking…"],
      rack: ["🖥️ Rack lights OK", "Temps look good", "Backups checked"],
      rackOk: ["🖥️ Rack lights OK"],
      brew: ["☕ Brewing coffee"],
      sip: ["Ahh~", "So good", "☕ sip sip"],
      reading: ["📚 Reading"],
      stretch: ["Stretch~"],
      meeting: ["OK, let's start"],
      bye: ["See ya~", "Let's go!", "bye bye", "Later!"],
      cheer: ["Done!", "Passed!", "Yay~"],
      askWave: ["Over here!", "Need your OK!", "Approve me~"],
      miniIn: ["Reporting!", "Yes sir!", "I'm here"],
      miniBye: ["Signing off! 👋"],
      miniIdle: ["On it!", "Checking…", "Reporting back", "What next?"],
    },
  };

  const norm = v => { const s = String(v || "").toLowerCase(); return s.startsWith("ko") ? "ko" : s.startsWith("en") ? "en" : ""; };
  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ""));
  const cut = (text, n) => { const a = Array.from(text || ""); return a.length > n ? a.slice(0, n).join("") + "…" : a.join(""); };
  const listeners = [];
  let lang = "en", fixed = false;

  (function detect() {
    const q = norm(new URLSearchParams(location.search).get("lang"));
    if (q) { lang = q; fixed = true; return; }
    let saved = "";
    try { saved = norm(localStorage.getItem(STORE)); } catch { /* 저장소를 못 쓰면 다음 순서로 */ }
    if (saved) { lang = saved; fixed = true; return; }
    lang = norm(navigator.language) === "ko" ? "ko" : "en";
  })();

  // 설정 파일의 lang 은 서버에서 받아 온다(주소·저장값이 없을 때만). 서버가 없으면 브라우저 언어 그대로.
  async function init() {
    if (!fixed) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 1500);
        const res = await fetch("/api/config", { signal: ctl.signal, cache: "no-store" });
        clearTimeout(timer);
        if (res.ok) { const c = await res.json(); const l = norm(c && c.lang); if (l) lang = l; }
      } catch { /* 설정을 못 읽어도 화면은 뜬다 */ }
    }
    document.documentElement.lang = lang;
  }
  function setLang(next) {
    next = norm(next);
    if (!next || next === lang) return;
    lang = next;
    try { localStorage.setItem(STORE, lang); } catch { /* 저장 못 해도 지금 화면은 바뀐다 */ }
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) { url.searchParams.set("lang", lang); history.replaceState(null, "", url); }
    document.documentElement.lang = lang;
    for (const f of listeners) f(lang);
  }

  const t = (key, vars) => fill(TEXT[lang][key] ?? TEXT.ko[key] ?? key, vars);
  const lines = name => LINES[lang][name] || LINES.ko[name] || [""];
  function act(x) {
    if (!x) return "";
    if (typeof x === "string") return x;                     // 옛 형식(이미 글)이면 그대로
    const k = String(x.k || ""), a = String(x.a ?? "").trim();
    if (k === "text" && !a) return "";
    const tpl = Object.hasOwn(ACT[lang], k) ? ACT[lang][k] : "";   // 모르는 k 는 인자만
    if (!tpl) return a ? `⚙️ ${a}` : "";
    return fill(tpl, { a: a || (Object.hasOwn(ACT_EMPTY[lang], k) ? ACT_EMPTY[lang][k] : "") });
  }
  // 승인 문구 — Claude 의 영어 알림을 한국어 화면에서는 짧게 바꾼다. 영어 화면은 원문 그대로,
  // short(말풍선·로그)일 때만 짧게("Allow Bash?"). 모르는 문구는 그대로.
  function ask(text, short) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    const tool = s.match(/^Claude needs your permission to use (.+?)\.?$/i);
    if (tool) return lang === "ko" || short ? t("ask.tool", { a: tool[1] }) : s;
    if (/^Claude (needs your input|is waiting for your input)\.?$/i.test(s)) return lang === "ko" || short ? t("ask.input") : s;
    if (/^[A-Za-z][\w.:-]{0,39}$/.test(s)) return t("ask.tool", { a: s });   // 도구 이름만 왔다(PermissionRequest)
    return s;
  }
  function ev(key, arg) {
    if (key === "ask") return t("ev.ask", { a: cut(ask(arg, true) || t("ev.check"), 24) });
    if (key === "subIn") return t("ev.subIn", { a: cut(arg || t("ev.task"), 22) });
    if (key === "subOut") return t("ev.subOut", { a: cut(arg || t("ev.end"), 22) });
    return t("ev." + key);
  }
  // 로그 시각 — 보는 사람의 시간대
  const time = ms => new Date(ms).toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-GB",
    { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return {
    get lang() { return lang; },
    init, setLang, onChange: f => listeners.push(f),
    t, lines, act, ask, ev, time, cut,
  };
})();
