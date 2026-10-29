// 工具执行器实现
import { warn, log } from '../util.js';

export class ToolExecutor {
  constructor({ memoryRetriever } = {}) {
    this.memoryRetriever = memoryRetriever;
  }

  async execute(name, args = {}, context = {}) {
    try {
      switch (name) {
        case 'get_current_time':
          return this.getCurrentTime();
        case 'get_weather':
          return await this.getWeather(args.city);
        case 'search_knowledge':
          return await this.searchKnowledge(args.keyword);
        case 'roll_dice':
          return this.rollDice(args.options, args.dice_sides);
        case 'calculate':
          return this.calculate(args.expression);
        case 'record_user_profile':
          return this.recordUserProfile(args, context);
        default:
          return { error: `未知的工具名称: ${name}` };
      }
    } catch (err) {
      warn(`执行工具 ${name} 出错: ${err.message}`);
      return { error: `执行工具失败: ${err.message}` };
    }
  }

  getCurrentTime() {
    const now = new Date();
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekday = weekdays[now.getDay()];
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    return {
      datetime: now.toLocaleString('zh-CN', { hour12: false }),
      date: now.toLocaleDateString('zh-CN'),
      time: now.toLocaleTimeString('zh-CN', { hour12: false }),
      weekday,
      isWeekend,
      hint: isWeekend ? '今天是周末，适合摸鱼吃白饭' : '今天是工作日/学习日',
    };
  }

  async getWeather(city) {
    const targetCity = String(city || 'Nanjing').trim();
    try {
      const url = `https://wttr.in/${encodeURIComponent(targetCity)}?format=j1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const current = data.current_condition?.[0];
      const today = data.weather?.[0];

      return {
        city: targetCity,
        temperature_c: current?.temp_C ?? '未知',
        weather: current?.weatherDesc?.[0]?.value ?? '晴',
        humidity: `${current?.humidity}%`,
        wind: `${current?.windspeedKmph} km/h`,
        feels_like: `${current?.FeelsLikeC}°C`,
        forecast: {
          max_temp: today?.maxtempC,
          min_temp: today?.mintempC,
          uv_index: today?.uvIndex,
        },
      };
    } catch (err) {
      return {
        city: targetCity,
        status: '查询异常',
        fallback: `获取 ${targetCity} 天气超时或网络不稳定，请直接向用户说明情况`,
      };
    }
  }

  async searchKnowledge(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return { error: '关键字为空' };

    try {
      const url = `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(kw)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = await res.json();
        return {
          title: data.title,
          description: data.description || '',
          extract: data.extract || '未找到详细描述',
        };
      }
    } catch {
      // 忽略，尝试其它搜索
    }

    return {
      keyword: kw,
      result: `未在百科中查到 ${kw} 的精确词条，可能是网络黑话或新词`,
    };
  }

  rollDice(options = null, diceSides = 6) {
    if (Array.isArray(options) && options.length > 0) {
      const idx = Math.floor(Math.random() * options.length);
      return {
        type: 'choice',
        candidates: options,
        picked: options[idx],
        reason: '命运的大肥鱼尾巴选中了这个',
      };
    }
    const sides = Number(diceSides) || 6;
    const roll = Math.floor(Math.random() * sides) + 1;
    return {
      type: 'dice',
      sides,
      result: roll,
    };
  }

  calculate(expression) {
    const raw = String(expression || '').trim();
    // 严格限制安全数学字符
    if (!/^[0-9+\-*/().^% \t\neE,sqrt|sin|cos|tan|pi|abs|log|ln|min|max]+$/i.test(raw)) {
      return { error: '表达式包含不安全的字符' };
    }

    try {
      // 替换数学常数与函数
      let sanitized = raw
        .replace(/\^/g, '**')
        .replace(/pi/gi, 'Math.PI')
        .replace(/sqrt\(/gi, 'Math.sqrt(')
        .replace(/sin\(/gi, 'Math.sin(')
        .replace(/cos\(/gi, 'Math.cos(')
        .replace(/tan\(/gi, 'Math.tan(')
        .replace(/abs\(/gi, 'Math.abs(')
        .replace(/log\(/gi, 'Math.log10(')
        .replace(/ln\(/gi, 'Math.log(');

      // 安全执行
      const fn = new Function(`"use strict"; return (${sanitized});`);
      const val = fn();
      return {
        expression: raw,
        result: typeof val === 'number' ? (Number.isInteger(val) ? val : Number(val.toFixed(6))) : val,
      };
    } catch (err) {
      return { error: `计算错误: ${err.message}` };
    }
  }

  recordUserProfile(args, context = {}) {
    const userId = context.userId;
    if (!userId || !this.memoryRetriever) {
      return { status: 'failed', reason: '无法确定当前用户身份' };
    }

    const { tags, notes } = args;
    const existing = this.memoryRetriever.getUserProfile(userId);
    const combinedTags = [
      ...new Set([
        ...(existing?.tags ? existing.tags.split(',') : []),
        ...(tags ? String(tags).split(/[,，\s]+/) : []),
      ]),
    ].join(',');

    const combinedNotes = existing?.notes
      ? `${existing.notes}；${notes}`
      : String(notes);

    this.memoryRetriever.upsertUserProfile(userId, {
      nickname: context.userName,
      tags: combinedTags,
      notes: combinedNotes,
    });

    // 同时沉淀为一条长期记忆
    this.memoryRetriever.recordMemory({
      chatKey: context.chatKey,
      userId,
      userName: context.userName,
      content: notes,
      keywords: tags || '',
    });

    return {
      status: 'success',
      message: `已成功把 ${context.userName} 的信息记在小本本上`,
    };
  }
}
