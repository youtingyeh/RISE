window.RISE_DATA = {
  // 正式內容備妥後改成 false，關閉全站範例提示。
  demo: true,

  site: {
    name: "RISE",
    chineseName: "國立臺灣大學數思新生計畫",
    englishName: "Reasoning and Inquiry for Science Education",
    introduction: "從提問出發，探索數學、物理與化學。"
  },

  about: {
    origin: "計畫緣起待填。",
    goals: "計畫目標與執行方式待填。",
    audience: "高中生。",
    contact: "聯絡單位與聯絡方式待填。"
  },

  subjects: [
    {
      id: "math",
      name: "數學",
      english: "MATHEMATICS",
      focus: "結構・規律・推理",
      description: "數學學科介紹待填。",
      topics: []
    },
    {
      id: "physics",
      name: "物理",
      english: "PHYSICS",
      focus: "現象・模型・實驗",
      description: "物理學科介紹待填。",
      topics: []
    },
    {
      id: "chemistry",
      name: "化學",
      english: "CHEMISTRY",
      focus: "物質・結構・變化",
      description: "化學學科介紹待填。",
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