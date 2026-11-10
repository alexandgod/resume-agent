/**
 * 资料服务：multer 落盘、白名单/10MB/50 份上限、文本粘贴、CRUD、重新解析。
 * 安全要点：
 *  - 落盘文件名一律 randomUUID + 白名单扩展名，绝不拼接用户 file_name（防路径穿越）；
 *  - data/uploads/<userId>/ 不挂 express.static，MVP 不提供原文件下载；
 *  - 所有私有查询强制 user_id 过滤，跨用户 403。
 * 资料与简历解耦：删除资料只删自身与本地文件，不触碰 resumes.content_json。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import {
  ALLOWED_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MATERIAL_TYPE,
  PARSE_STATUS,
  AppError,
  CODE,
  getMaxFileSizeBytes,
  getMaxMaterialsPerUser,
  getUploadsDir,
} from '../domain/contracts.js';
import { repo } from '../store/repository.js';
import { parse } from './parseService.js';

function nowIso() {
  return new Date().toISOString();
}

/** 从原始文件名提取并小写化扩展名（只用于白名单比较，不用于落盘路径）。 */
export function safeExtension(originalName) {
  return path.extname(String(originalName || '')).toLowerCase();
}

/** 扩展名 → 资料类型。 */
export function materialTypeFromExt(ext) {
  const value = String(ext || '').toLowerCase();
  if (value === '.txt') return MATERIAL_TYPE.TXT;
  if (value === '.md') return MATERIAL_TYPE.MD;
  if (value === '.pdf') return MATERIAL_TYPE.PDF;
  if (value === '.docx' || value === '.doc') return value === '.docx' ? MATERIAL_TYPE.DOCX : MATERIAL_TYPE.DOC;
  if (IMAGE_EXTENSIONS.includes(value)) return MATERIAL_TYPE.IMAGE;
  return MATERIAL_TYPE.TXT;
}

/** 把绝对路径转为相对路径字符串（不含公网 URL）。 */
function toRelativeFileUrl(absolutePath) {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join('/');
}

function toAbsolutePath(fileUrl) {
  return path.isAbsolute(String(fileUrl)) ? String(fileUrl) : path.resolve(process.cwd(), String(fileUrl));
}

/** 创建 multer 中间件：目标目录按 req.user.id 动态生成，文件名一律 UUID。 */
export function createUploadMiddleware() {
  const storage = multer.diskStorage({
    destination: (req, file, callback) => {
      const userId = req.user?.id;
      if (!userId) {
        return callback(new AppError(CODE.UNAUTHORIZED, '请先登录'));
      }
      try {
        const dir = getUploadsDir(userId);
        fs.mkdirSync(dir, { recursive: true });
        return callback(null, dir);
      } catch {
        return callback(new AppError(CODE.INTERNAL, '上传目录创建失败'));
      }
    },
    filename: (req, file, callback) => {
      const ext = safeExtension(file.originalname);
      return callback(null, `${randomUUID()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: getMaxFileSizeBytes(), files: 20 },
    fileFilter: (req, file, callback) => {
      const ext = safeExtension(file.originalname);
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return callback(new AppError(CODE.UNPROCESSABLE, `不支持的文件类型：${ext || '未知'}`, {
          errKey: 'FILE_TYPE_NOT_ALLOWED',
        }));
      }
      return callback(null, true);
    },
  });
}

/** 资料列表（按 created_at 倒序）。 */
export async function list(userId) {
  const items = await repo.findByUser('materials', userId);
  return items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/** 文本粘贴新增资料。 */
export async function addText(userId, dto) {
  const rawText = String(dto?.rawText || '').trim();
  if (!rawText) {
    throw new AppError(CODE.UNPROCESSABLE, '文本内容不能为空', { errKey: 'EMPTY_TEXT' });
  }
  const limit = getMaxMaterialsPerUser();
  const current = await repo.count('materials', (m) => m.user_id === userId);
  if (current >= limit) {
    throw new AppError(CODE.RATE_LIMITED, `资料数量已达上限（${limit} 份），请先删除部分资料`, {
      errKey: 'MATERIAL_LIMIT',
    });
  }
  const title = String(dto?.title || '').trim() || `文本资料 ${new Date().toLocaleString('zh-CN')}`;
  return repo.insert('materials', {
    user_id: userId,
    resume_id: null,
    type: MATERIAL_TYPE.TEXT,
    file_name: title,
    file_url: '',
    raw_text: rawText,
    parsed_text: rawText,
    parse_status: PARSE_STATUS.SUCCESS,
    parse_message: '',
    size: Buffer.byteLength(rawText, 'utf8'),
    created_at: nowIso(),
  });
}

/** 批量上传：逐文件落盘 → 解析 → 回写状态；失败逐条返回原因，不阻塞其他文件。 */
export async function addUploads(userId, files) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    throw new AppError(CODE.UNPROCESSABLE, '请选择要上传的文件', { errKey: 'NO_FILES' });
  }
  const limit = getMaxMaterialsPerUser();
  const current = await repo.count('materials', (m) => m.user_id === userId);
  if (current + list.length > limit) {
    await Promise.all(list.map((file) => fsp.rm(file.path, { force: true }).catch(() => undefined)));
    throw new AppError(CODE.RATE_LIMITED, `资料数量已达上限（${limit} 份），请先删除部分资料`, {
      errKey: 'MATERIAL_LIMIT',
    });
  }

  const items = [];
  const failed = [];
  for (const file of list) {
    const ext = safeExtension(file.originalname);
    const type = materialTypeFromExt(ext);
    const material = await repo.insert('materials', {
      user_id: userId,
      resume_id: null,
      type,
      file_name: String(file.originalname || '未命名文件'),
      file_url: toRelativeFileUrl(file.path),
      raw_text: '',
      parsed_text: '',
      parse_status: PARSE_STATUS.PENDING,
      parse_message: '',
      size: Number(file.size || 0),
      created_at: nowIso(),
    });
    const result = await parse({ ...material, file_url: toAbsolutePath(material.file_url) });
    const updated = await repo.update('materials', material.id, {
      parsed_text: result.parsed_text,
      parse_status: result.parse_status,
      parse_message: result.message,
    });
    if (result.parse_status === PARSE_STATUS.FAILED) {
      failed.push({ fileName: material.file_name, reason: result.message });
    }
    items.push(updated);
  }
  return { items, failed };
}

/** 读取单条资料（跨用户 403）。 */
export async function get(userId, id) {
  return repo.getOwned('materials', userId, id);
}

/** 编辑资料：支持改标题、原文、手动补录解析文本。 */
export async function update(userId, id, dto) {
  const material = await repo.getOwned('materials', userId, id);
  const patch = {};
  if (dto?.title !== undefined) {
    const title = String(dto.title).trim();
    if (!title) {
      throw new AppError(CODE.UNPROCESSABLE, '资料名称不能为空', { errKey: 'EMPTY_TITLE' });
    }
    patch.file_name = title;
  }
  if (dto?.rawText !== undefined) {
    patch.raw_text = String(dto.rawText);
    if (material.type === MATERIAL_TYPE.TEXT) {
      patch.parsed_text = String(dto.rawText);
      patch.parse_status = String(dto.rawText).trim() ? PARSE_STATUS.SUCCESS : PARSE_STATUS.FAILED;
      patch.parse_message = String(dto.rawText).trim() ? '' : '解析失败，可手动补录';
      patch.size = Buffer.byteLength(String(dto.rawText), 'utf8');
    }
  }
  if (dto?.parsedText !== undefined) {
    const text = String(dto.parsedText);
    patch.parsed_text = text;
    patch.parse_status = text.trim() ? PARSE_STATUS.SUCCESS : PARSE_STATUS.FAILED;
    patch.parse_message = text.trim() ? '' : '解析失败，可手动补录';
  }
  return repo.update('materials', id, patch);
}

/** 删除资料（同时清理本地文件，不影响已生成简历）。 */
export async function remove(userId, id) {
  const material = await repo.getOwned('materials', userId, id);
  if (material.file_url) {
    try {
      await fsp.rm(toAbsolutePath(material.file_url), { force: true });
    } catch {
      // 文件不存在不阻塞删除。
    }
  }
  await repo.remove('materials', id);
  return { deleted: true };
}

/** 重新解析：文本类直接用原文，文件类重新走解析分派。 */
export async function reparse(userId, id) {
  const material = await repo.getOwned('materials', userId, id);
  if (!material.file_url && material.type !== MATERIAL_TYPE.TEXT) {
    throw new AppError(CODE.UNPROCESSABLE, '原文件不存在，请手动补录文字', { errKey: 'FILE_MISSING' });
  }
  const target = material.file_url
    ? { ...material, file_url: toAbsolutePath(material.file_url) }
    : material;
  const result = await parse(target);
  return repo.update('materials', id, {
    parsed_text: result.parsed_text,
    parse_status: result.parse_status,
    parse_message: result.message,
  });
}

/** 账号注销时清理该用户的整个上传目录。 */
export async function removeUserUploads(userId) {
  try {
    await fsp.rm(getUploadsDir(userId), { recursive: true, force: true });
  } catch {
    // 清理失败不阻塞注销。
  }
}
