export interface HelpStep {
  title: string;
  body: string;
}

export interface HelpFlow {
  title: string;
  items: string[];
}

export interface HelpFaq {
  question: string;
  answer: string;
}

export interface HelpAction {
  label: string;
  to: string;
  primary?: boolean;
}

export interface HelpSection {
  id: string;
  title: string;
  summary: string;
  steps?: HelpStep[];
  flows?: HelpFlow[];
  notes?: string[];
  faqs?: HelpFaq[];
  actions?: HelpAction[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'start',
    title: '快速開始',
    summary: 'JoyIn 是給 LINE 群組用的活動報名。群組裡只看卡片，報名與管理都在網頁完成。',
    steps: [
      {
        title: '將 JoyIn 加入 LINE 群組',
        body: '把 JoyIn 官方帳號加為好友，再邀請進要辦活動的群組。活動會綁定這個群組。',
      },
      {
        title: '在群組輸入 /list',
        body: 'Bot 只回覆一則卡片，顯示這個群組最近五筆尚未結束的活動，避免洗版。',
      },
      {
        title: '點擊活動卡片進入網頁',
        body: '卡片會開啟 JoyIn 網頁。完整列表、報名、代報與主揪管理都在這裡操作。',
      },
    ],
    notes: [
      '還沒登入也能先閱讀這份使用手冊。',
      '實際報名仍需從 LINE 群組開啟，系統才能知道你屬於哪個群組。',
    ],
    actions: [
      { label: '新增活動', to: '/events/new', primary: true },
      { label: '查看參加者操作', to: '/help/join' },
    ],
  },
  {
    id: 'join',
    title: '參加者操作',
    summary: '查看活動、本人報名、取消與看名單，都在網頁完成。',
    steps: [
      {
        title: '查看活動',
        body: '群組 /list 看最近五筆。點卡片後，網頁會列出這個群組所有尚未結束的活動。',
      },
      {
        title: '本人報名',
        body: '進入活動詳情，點「本人報名」。同一場活動，同一個 LINE 帳號只能本人報名一次。',
      },
      {
        title: '取消報名',
        body: '在正式名單或候補名單找到自己，點「取消」。只能取消自己的本人報名。',
      },
      {
        title: '額滿後加入候補',
        body: '正式名額額滿且活動有開放候補時，按鈕會變成「加入候補」。',
      },
      {
        title: '查看報名名單',
        body: '詳情頁會分開顯示正式報名與候補。候補會標示目前順位。',
      },
    ],
    flows: [
      {
        title: '報名流程',
        items: ['在群組輸入 /list', '點活動卡片', '進入詳情點本人報名'],
      },
    ],
    actions: [
      { label: '前往活動列表', to: '/', primary: true },
      { label: '代報與取消', to: '/help/proxy' },
    ],
  },
  {
    id: 'organize',
    title: '主揪操作',
    summary: '任何群組成員都能新增活動；建立者自動成為主揪。',
    steps: [
      {
        title: '新增活動',
        body: '在網頁點「新增活動」，填名稱、時間範圍、地址、人數與候補後儲存。你會成為主揪。',
      },
      {
        title: '設定開始與結束時間',
        body: '開始、結束都要填日期與時間。結束時間必須晚於開始時間。列表依開始時間由近到遠排序。',
      },
      {
        title: '地址與人數',
        body: '地址給參加者看怎麼到場。人數上限是正式報名名額，不可低於目前已報名人數。',
      },
      {
        title: '開啟或關閉候補',
        body: '開啟後，額滿的人會依序候補。仍有候補時不能關閉候補。',
      },
      {
        title: '編輯活動',
        body: '只有主揪能編輯。若改時間或地點，送出前會再請你確認。',
      },
      {
        title: '關閉報名',
        body: '關閉後不能再報名或代報，已報名資料仍保留。',
      },
      {
        title: '刪除活動',
        body: '這是軟刪除，列表不再顯示。請先確認再刪。',
      },
    ],
    actions: [
      { label: '新增活動', to: '/events/new', primary: true },
      { label: '複製活動', to: '/help/copy' },
      { label: '轉移主揪', to: '/help/transfer' },
    ],
  },
  {
    id: 'proxy',
    title: '代報與取消',
    summary: '可以幫還沒開 JoyIn 的朋友報名，顯示名稱會標註是誰代報。',
    steps: [
      {
        title: '幫別人代報',
        body: '在詳情頁輸入參加者姓名，點「代他人報名」。同一場、同一位代報者，不能重複代報相同姓名。',
      },
      {
        title: '額滿時代報',
        body: '若已額滿且有開放候補，代報會進入候補，並依加入順序排隊。',
      },
      {
        title: '取消自己代報的人員',
        body: '在名單找到「姓名（你 代報）」後點取消。不能取消別人的報名，主揪則可以協助取消。',
      },
    ],
    flows: [
      {
        title: '代報流程',
        items: ['進入活動詳情', '填寫參加者姓名', '送出代報，名單會標註代報者'],
      },
    ],
    actions: [
      { label: '前往活動列表', to: '/', primary: true },
      { label: '候補規則', to: '/help/waitlist' },
    ],
  },
  {
    id: 'waitlist',
    title: '候補與自動遞補',
    summary: '正式名額額滿後，後續的人依加入時間排隊。有人取消時，第一順位會自動轉正。',
    steps: [
      {
        title: '何時會進候補',
        body: '活動有開候補，且正式人數已滿。本人報名與代報都適用。',
      },
      {
        title: '順位怎麼排',
        body: '依加入候補的時間，越早越前面。詳情頁會顯示候補第幾位。',
      },
      {
        title: '有人取消之後',
        body: '系統自動把最早加入的候補轉成正式報名。代報轉正後，姓名與代報標記會保留。',
      },
    ],
    notes: [
      '沒有開放候補時，額滿就不能再報名。',
      '主揪把人數調低時，不可低於目前正式報名人數。',
    ],
    actions: [{ label: '查看參加者操作', to: '/help/join', primary: true }],
  },
  {
    id: 'copy',
    title: '複製活動',
    summary: '沿用名稱、地址與人數設定，重新排一場新的時間。',
    steps: [
      {
        title: '從詳情頁複製',
        body: '任何看得到這場活動的群組成員，都可以點「複製活動」。',
      },
      {
        title: '會帶入什麼',
        body: '名稱、地址、可報名人數、候補開關。開始與結束時間要重新填。',
      },
      {
        title: '不會複製什麼',
        body: '報名名單、主揪轉移紀錄，以及舊的活動 ID。儲存後是全新一場，你會成為主揪。',
      },
    ],
    actions: [
      { label: '前往活動列表', to: '/', primary: true },
      { label: '查看主揪操作', to: '/help/organize' },
    ],
  },
  {
    id: 'transfer',
    title: '轉移主揪',
    summary: '用一次性邀請連結交給對方。不需要輸入 LINE User ID。',
    steps: [
      {
        title: '主揪產生連結',
        body: '在活動詳情的主揪管理區點「產生轉移連結」，再把連結傳給新主揪。',
      },
      {
        title: '對方開啟並確認',
        body: '對方用 LINE 開啟連結後，系統以登入身分辨識。必須再按確認，轉移才完成。',
      },
      {
        title: '連結規則',
        body: '每個連結只能用一次，並有有效期限。取消或重新產生後，舊連結立刻失效。',
      },
    ],
    flows: [
      {
        title: '轉移主揪流程',
        items: ['原主揪產生連結', '分享給對方', '對方登入後按確認'],
      },
    ],
    notes: ['不能把主揪轉移給自己。', '未登入無法接受轉移，但可以先閱讀這頁說明。'],
    actions: [
      { label: '前往活動列表', to: '/', primary: true },
      { label: '常見問題', to: '/help/faq' },
    ],
  },
  {
    id: 'commands',
    title: 'LINE Bot 指令',
    summary: '群組指令刻意保持極簡，完整操作都在網頁。',
    steps: [
      {
        title: '/list',
        body: '顯示目前群組中最近的五筆活動。完整活動請點擊卡片進入 JoyIn 網頁查看。',
      },
    ],
    notes: ['群組裡不會出現報名成功或取消的洗版訊息。'],
    actions: [{ label: '快速開始', to: '/help/start', primary: true }],
  },
  {
    id: 'faq',
    title: '常見問題',
    summary: '先看這裡，多半能找到答案。',
    faqs: [
      {
        question: '為什麼 /list 沒有列出全部活動？',
        answer: '群組卡片只顯示最近五筆尚未結束的活動。完整列表請點卡片進入網頁。',
      },
      {
        question: '一定要從 LINE 群組開啟嗎？',
        answer: '活動屬於群組。請在群組輸入 /list，再點卡片進入，系統才能對到正確的群組。',
      },
      {
        question: '轉移主揪要填 LINE User ID 嗎？',
        answer: '不用。產生邀請連結給對方，對方登入後按確認即可。',
      },
      {
        question: '結束時間可以跟開始時間相同嗎？',
        answer: '不行。結束時間必須晚於開始時間。',
      },
      {
        question: '複製活動會把報名名單一起帶過去嗎？',
        answer: '不會。名單、轉移紀錄與舊活動 ID 都不會複製。你只要重設時間。',
      },
      {
        question: '關閉報名後還能看到名單嗎？',
        answer: '可以。只是不能再新增報名或代報。',
      },
      {
        question: '重新開啟 JoyIn 後活動會不見嗎？',
        answer: '不會。列表每次都會向伺服器重新載入尚未結束的活動。',
      },
    ],
    actions: [
      { label: '快速開始', to: '/help/start', primary: true },
      { label: '前往活動列表', to: '/' },
    ],
  },
];

export function getHelpSection(id: string | undefined): HelpSection | undefined {
  if (!id) return HELP_SECTIONS[0];
  return HELP_SECTIONS.find((section) => section.id === id);
}
