/**
 * 资料解析服务：
 * - TXT/MD 内置抽取（UTF-8）；
 * - PDF/DOCX 用 optionalDependencies 的动态 import + try/catch，任何失败都标记
 *   parse_status=failed 且提示「解析失败，可手动补录」，绝不阻塞上传与生成闭环；
 * - 图片 parse_status=skipped，仅存档、不参与生成。
 * 零系统级依赖，绝不引入 canvas 等原生模块。
 */
import fs from 'node:fs/promises';
import { MATERIAL_TYPE, PARSE_STATUS } from '../domain/contracts.js';

const FAILED_MESSAGE = '解析失败，可手动补录';
const SKIPPED_MESSAGE = '图片仅存档，暂不参与生成（可手动补录文字）';

/** TXT/MD 内置抽取。 */
export async function parseTxtMd(buffer) {
  return String(buffer.toString('utf8') || '').replace(/\r\n/g, '\n').trim();
}

/** PDF 纯文本抽取（动态 import，失败由调用方降级）。 */
export async function tryParsePdf(buffer) {
  // pdfjs-dist 在 Node 环境可能引用 DOMMatrix，注入最小 polyfill；仍失败即降级。
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      }
    };
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosityLevel: 0,
  });
  const pdf = await task.promise;
  const total = Math.min(Number(pdf.numPages || 0), 200);
  const pages = [];
  for (let pageNo = 1; pageNo <= total; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const line = (content.items || [])
      .map((item) => (typeof item?.str === 'string' ? item.str : ''))
      .join(' ');
    pages.push(line);
  }
  if (typeof pdf.destroy === 'function') {
    await pdf.destroy();
  }
  return pages.join('\n').trim();
}

/** DOCX 纯文本抽取（动态 import，失败由调用方降级）。 */
export async function tryParseDocx(buffer) {
  const module = await import('mammoth');
  const mammoth = module?.default?.extractRawText ? module.default : module;
  if (typeof mammoth.extractRawText !== 'function') {
    throw new Error('DOCX 解析组件不可用');
  }
  const result = await mammoth.extractRawText({ buffer });
  return String(result?.value || '').trim();
}

/**
 * 按资料类型分派解析，返回 {parsed_text, parse_status, message}。
 * 本函数自身永不抛错：任何异常都收敛为 failed。
 */
export async function parse(material) {
  const type = String(material?.type || '').toLowerCase();
  const rawText = String(material?.raw_text || '');

  if (type === MATERIAL_TYPE.TEXT) {
    return {
      parsed_text: rawText,
      parse_status: rawText.trim() ? PARSE_STATUS.SUCCESS : PARSE_STATUS.FAILED,
      message: rawText.trim() ? '' : FAILED_MESSAGE,
    };
  }
  if (type === MATERIAL_TYPE.IMAGE) {
    return { parsed_text: '', parse_status: PARSE_STATUS.SKIPPED, message: SKIPPED_MESSAGE };
  }

  let buffer;
  try {
    buffer = await fs.readFile(String(material?.file_url || ''));
  } catch {
    return { parsed_text: '', parse_status: PARSE_STATUS.FAILED, message: FAILED_MESSAGE };
  }

  try {
    if (type === MATERIAL_TYPE.TXT || type === MATERIAL_TYPE.MD) {
      const text = await parseTxtMd(buffer);
      return {
        parsed_text: text,
        parse_status: text.trim() ? PARSE_STATUS.SUCCESS : PARSE_STATUS.FAILED,
        message: text.trim() ? '' : FAILED_MESSAGE,
      };
    }
    if (type === MATERIAL_TYPE.PDF) {
      const text = await tryParsePdf(buffer);
      return {
        parsed_text: text,
        parse_status: text.trim() ? PARSE_STATUS.SUCCESS : PARSE_STATUS.FAILED,
        message: text.trim() ? '' : FAILED_MESSAGE,
      };
    }
    if (type === MATERIAL_TYPE.DOCX || type === MATERIAL_TYPE.DOC) {
      const text = await tryParseDocx(buffer);
      return {
        parsed_text: text,
        parse_status: text.trim() ? PARSE_STATUS.SUCCESS : PARSE_STATUS.FAILED,
        message: text.trim() ? '' : FAILED_MESSAGE,
      };
    }
    return { parsed_text: '', parse_status: PARSE_STATUS.FAILED, message: FAILED_MESSAGE };
  } catch {
    // 可选解析库未安装、加载失败或运行异常：一律降级，不阻塞闭环。
    return { parsed_text: '', parse_status: PARSE_STATUS.FAILED, message: FAILED_MESSAGE };
  }
}
