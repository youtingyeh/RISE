window.RISE_DATA = {
  // 正式內容備妥後改成 false，關閉全站範例提示。
  demo: true,

  site: {
    name: "RISE",
    chineseName: "國立臺灣大學數思新生計畫",
    englishName: "Reasoning and Inquiry for Science Education",
    introduction: "從理解概念、寫出推理，到提出值得探索的問題。"
  },

  about: {
    origin: "《數思新生》以青少年數理能力與提問力的雙軌培育為核心。計畫重視抽象概念、邏輯推理與結構化思考，透過練習、錯誤分析及回饋，協助學生由理解知識走向運用能力。",
    goals: "數理軌以模組教材、過程導向練習與助教回饋支持能力養成；提問軌引導學生說明問題背景、動機與可能影響，並規劃訓練營、競賽及學者對談。教師、助教與學生社群共同支持持續學習。",
    audience: "數理模組主要面向具數理興趣與傾向的高中生；計畫中的提問訓練營與競賽另涵蓋高中及大專學生。各活動正式資格以後續公告為準。",
    contact: "聯絡單位與聯絡方式待填。"
  },

  subjects: [
    {
      id: "math",
      name: "數學",
      english: "MATHEMATICS",
      focus: "結構・規律・推理",
      description: "依 2025 年 11 月版計畫，數學為初期教材主軸，重視概念理解、推理演算與完整思考過程。以下為計畫列出的主題，教材尚待提供。",
      topics: [
  {
    "title": "連續函數",
    "description": "計畫規劃強化的數學主題；先備概念與正式單元待確認。"
  },
  {
    "title": "收斂與發散",
    "description": "計畫規劃強化的數學主題；教材與練習題待提供。"
  },
  {
    "title": "數列與級數",
    "description": "計畫規劃強化的數學主題；教材與練習題待提供。"
  },
  {
    "title": "向量分析",
    "description": "計畫規劃強化的數學主題；教材與練習題待提供。"
  },
  {
    "title": "微積分應用於力學",
    "description": "連結數學概念與物理問題的規劃主題；正式學習順序待確認。"
  }
]
    },
    {
      id: "physics",
      name: "物理",
      english: "PHYSICS",
      focus: "現象・模型・實驗",
      description: "計畫規劃接續數學建置物理模組，以力學與光學為重點，連結數學概念、自然現象與模型推理。目前不表示已開課。",
      topics: [
  {
    "title": "力學",
    "description": "計畫規劃強化主題；教材、先備條件與練習題待提供。"
  },
  {
    "title": "光學",
    "description": "計畫規劃強化主題；教材、先備條件與練習題待提供。"
  }
]
    },
    {
      id: "chemistry",
      name: "化學",
      english: "CHEMISTRY",
      focus: "物質・結構・變化",
      description: "化學依網站後續需求保留為擴充入口。2025 年 11 月版計畫書未列出獨立化學模組；正式課程範圍、教材與期程待確認。",
      topics: []
    }
  ],

  // 以下為範例欄位，沒有連接正式影片。
  // 新增影片時，每筆 id 必須不同。
  videos: [
    {
      id: "math-demo",
      subject: "math",
      title: "數學影片｜標題待填",
      summary: "影片簡介待填。",
      speaker: "",
      level: "",
      duration: "",
      youtubeId: "",
      keywords: [],
      question: "",
      reflection: "",
      chapters: [],
      demo: true
    },
    {
      id: "physics-demo",
      subject: "physics",
      title: "物理影片｜標題待填",
      summary: "影片簡介待填。",
      speaker: "",
      level: "",
      duration: "",
      youtubeId: "",
      keywords: [],
      question: "",
      reflection: "",
      chapters: [],
      demo: true
    },
    {
      id: "chemistry-demo",
      subject: "chemistry",
      title: "化學影片｜標題待填",
      summary: "影片簡介待填。",
      speaker: "",
      level: "",
      duration: "",
      youtubeId: "",
      keywords: [],
      question: "",
      reflection: "",
      chapters: [],
      demo: true
    }
  ],

  // 團隊成員尚未提供。
  // 格式：
  // {name:"姓名", role:"職稱", affiliation:"單位", subject:"math", bio:"介紹"}
  team: [],

  // 正式日程尚未提供。
  // 格式：
  // {date:"YYYY-MM-DD", title:"活動名稱", location:"地點", description:"說明", url:""}
  events: [],

  // 正式教材尚未提供。
  // 格式：
  // {subject:"math", title:"教材名稱", type:"PDF", description:"說明", url:""}
  resources: []
};
