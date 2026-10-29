// 快速意图判定：是否需要挂载工具 Schema
// 纯闲聊/接梗走 Fast Path（节省 400+ Prompt Token，大幅减少大模型首包 Prefill 延迟）
export function shouldEnableTools(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  if (clean.length === 0) return false;

  // 1. 天气相关
  if (/天气|气温|下雨|下雪|阴天|晴天|冷不冷|热不热|温度|多少度|预报/i.test(clean)) return true;

  // 2. 时间/日期/星期/日历相关
  if (/几点|现在时间|当前时间|今天周几|星期几|礼拜几|什么日子|今天是几号|几月几号|节假日|周末/i.test(clean)) return true;

  // 3. 数学算术与表达式
  if (/(?:[0-9]{1,}[+\-*/^%][0-9]{1,})|算一下|计算|等于多少|开方|平方|sin|cos|log|pow/i.test(clean)) return true;

  // 4. 随机做决定 / 掷骰子 / 选一个
  if (/吃什么|喝什么|去哪|选一个|还是|帮我选|帮我决定|掷骰子|摇骰子|抽签|抽个/i.test(clean)) return true;

  // 5. 百科与概念查询
  if (/是什么|百科|介绍一下|什么是|定义|原理|谁是/i.test(clean)) return true;

  // 6. 档案与个人背景记录
  if (/记住我|我的名字|我是.*专业|我是.*大学|我喜欢/i.test(clean)) return true;

  return false;
}

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取当前现实世界的精确时间、日期、星期几与是否周末',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询指定城市或地区的实时天气与预报',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名（中文或拼音），例如：南京、北京、上海、Nanjing',
          },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: '联网百科知识库搜索，查询名词、专业术语、大学、历史或人物事实背景',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '搜索词或概念名称，例如：南京大学、线性代数、反向传播算法',
          },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'roll_dice',
      description: '随机二选一/多选一、掷骰子、抽签或做随机决定',
      parameters: {
        type: 'object',
        properties: {
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '备选列表，例如 ["大白饭", "寿喜烧"] 或 ["去图书馆", "在宿舍睡觉"]',
          },
          dice_sides: {
            type: 'integer',
            description: '骰子面数（默认 6）',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: '执行数学算术计算（加减乘除、乘方、开方、三角函数等）',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，例如 "2^10" 或 "sin(pi/2) + sqrt(144)" 或 "3.14 * 15^2"',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_user_profile',
      description: '主动将当前对话群友的个人特征、专业、爱好、外号或重要记忆记入档案',
      parameters: {
        type: 'object',
        properties: {
          tags: {
            type: 'string',
            description: '提取的标签，如 "南大AI,喜欢吃白饭,经常熬夜"',
          },
          notes: {
            type: 'string',
            description: '值得记住的详细事实或特征',
          },
        },
        required: ['notes'],
      },
    },
  },
];
