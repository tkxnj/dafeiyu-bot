// 表情包与富媒体表情互动模块
import fs from 'node:fs';
import path from 'node:path';

// QQ 经典 Face 表情 ID 映射
export const FACE_ID_MAP = {
  '傲娇': 21,
  '翻白眼': 21,
  '白眼': 21,
  '吐泡泡': 18,
  '吐': 18,
  '翻肚皮': 34,
  '晕鱼': 34,
  '晕': 34,
  '哭': 9,
  '大哭': 9,
  '害羞': 6,
  '脸红': 6,
  '坏笑': 4,
  '得意': 4,
  '摸鱼': 14,
  '微笑': 14,
  '问号': 32,
  '疑惑': 32,
  '炸毛': 33,
  '惊讶': 33,
  '爱心': 66,
  '撒娇': 109,
  '白饭': 61,
  '吃白饭': 61,
  '干饭': 61,
  '无语': 114,
  '嫌弃': 114,
  '拜拜': 39,
  '溜了': 39,
};

const MEME_TAG_REGEX = /\[表情\s*[:：]\s*([^\]]+)\]/g;
const CQ_FACE_REGEX = /\[CQ:face,id=(\d+)\]/g;

export class MemeManager {
  constructor({ memesDir } = {}) {
    this.memesDir = memesDir;
  }

  // 检查本地是否有对应名称的表情包图片
  findLocalMemeImage(keyword) {
    if (!this.memesDir) return null;
    const clean = String(keyword).trim().toLowerCase();
    const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

    for (const ext of extensions) {
      const filePath = path.join(this.memesDir, `${clean}${ext}`);
      try {
        if (fs.existsSync(filePath)) {
          return path.resolve(filePath);
        }
      } catch {
        // 忽略
      }
    }
    return null;
  }

  // 将包含 [表情: xxx] 或 [CQ:face,id=...] 的文本解析为 OneBot 11 消息段数组
  parseMessageToSegments(bubbleText) {
    if (!bubbleText) return [];

    const segments = [];
    let currentIdx = 0;

    // 合并匹配：[表情: xxx] 和 [CQ:face,id=xxx]
    const combinedRegex = /\[(?:表情\s*[:：]\s*([^\]]+)|CQ:face,id=(\d+))\]/g;
    let match;

    while ((match = combinedRegex.exec(bubbleText)) !== null) {
      const matchStart = match.index;
      const matchEnd = combinedRegex.lastIndex;

      // 匹配项前面的文本
      if (matchStart > currentIdx) {
        const textPart = bubbleText.slice(currentIdx, matchStart);
        if (textPart) {
          segments.push({ type: 'text', data: { text: textPart } });
        }
      }

      const expressionName = match[1]?.trim();
      const directFaceId = match[2];

      if (expressionName) {
        // 优先检查本地是否有同名表情包图片
        const localImgPath = this.findLocalMemeImage(expressionName);
        if (localImgPath) {
          segments.push({
            type: 'image',
            data: { file: `file:///${localImgPath.replace(/\\/g, '/')}` },
          });
        } else {
          // 降级为 QQ 原生 Face ID
          const faceId = FACE_ID_MAP[expressionName] || 14;
          segments.push({
            type: 'face',
            data: { id: String(faceId) },
          });
        }
      } else if (directFaceId) {
        segments.push({
          type: 'face',
          data: { id: String(directFaceId) },
        });
      }

      currentIdx = matchEnd;
    }

    // 剩余文本
    if (currentIdx < bubbleText.length) {
      const remaining = bubbleText.slice(currentIdx);
      if (remaining) {
        segments.push({ type: 'text', data: { text: remaining } });
      }
    }

    return segments.length > 0 ? segments : [{ type: 'text', data: { text: bubbleText } }];
  }
}
