/**
 * content_json 完整 Schema（3.3 节）。
 * 本文件保持「同构」：不引入任何 node: 内置模块，前端 Vite 亦可直接复用 SAMPLE_CONTENT。
 * 约定：数组顺序即展示顺序；每个数组元素带 id 作为稳定 key；任何写入路径都必须先过 normalizeContent()。
 */

/** 可直接照抄的空简历结构。 */
export const EMPTY_CONTENT = {
  basic: {
    name: '', gender: '', birthDate: '', phone: '', email: '',
    location: '', jobTarget: '', avatarUrl: '', links: [],
  },
  education: [],
  work: [],
  project: [],
  skill: [],
  certificate: [],
  summary: { content: '', highlights: [] },
  meta: { schemaVersion: 1, generatedMode: 'manual', configSource: 'none', updatedAt: '' },
};

/** 7 个业务分区。 */
export const SECTION_KEYS = ['basic', 'education', 'work', 'project', 'skill', 'certificate', 'summary'];

/** 示例数据：仅用于模板缩略图，不含任何真实个人信息，也不含任何密钥。 */
const SAMPLE_RAW = {
  basic: {
    name: '李示例',
    gender: '女',
    birthDate: '1998-05',
    phone: '',
    email: '',
    location: '深圳',
    jobTarget: '前端工程师',
    avatarUrl: '',
    links: [{ label: '个人主页', url: 'https://example.com' }],
  },
  education: [
    {
      id: 'sample-e1', school: '示例大学', degree: '本科', major: '计算机科学与技术',
      startDate: '2016-09', endDate: '2020-06', description: '主修课程：数据结构、Web 开发',
    },
  ],
  work: [
    {
      id: 'sample-w1', company: '示例科技有限公司', position: '前端工程师', location: '深圳',
      startDate: '2020-07', endDate: '2024-03',
      highlights: ['负责后台管理系统重构，首屏加载时间下降 40%', '主导组件库建设，沉淀 30+ 通用组件'],
    },
  ],
  project: [
    {
      id: 'sample-p1', name: '示例数据看板', role: '前端负责人',
      startDate: '2023-02', endDate: '2023-09',
      description: '面向运营团队的可视化分析平台。',
      highlights: ['独立完成图表引擎封装', '支撑日均 2 万次访问'],
      link: 'https://example.com/project',
    },
  ],
  skill: [
    { id: 'sample-s1', category: '前端', items: ['React', 'TypeScript', 'Vite'], level: '熟练' },
    { id: 'sample-s2', category: '工程化', items: ['Git', 'Docker', 'CI/CD'], level: '掌握' },
  ],
  certificate: [
    { id: 'sample-c1', name: '大学英语六级', issuer: '教育部考试中心', date: '2019-06', description: '' },
  ],
  summary: {
    content: '4 年前端开发经验，熟悉组件化与工程化实践，注重交付质量与协作效率。',
    highlights: ['主导 3 个从 0 到 1 的项目', '持续沉淀可复用技术方案'],
  },
  meta: { schemaVersion: 1, generatedMode: 'manual', configSource: 'none', updatedAt: '' },
};

// ── 通用规范化工具（纯函数，绝不抛错） ────────────────────────────
let idSeed = 0;

/** 生成本地稳定 id，不依赖 crypto，浏览器/Node 均可运行。 */
function nextId(prefix) {
  idSeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeed.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asStringList(value) {
  return asArray(value).map(asString).filter((item) => item.trim() !== '');
}

/** 丢弃全空条目，避免渲染空白区块。 */
function hasValue(item) {
  return Object.keys(item).some((key) => {
    if (key === 'id') return false;
    const value = item[key];
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === 'string' && value.trim() !== '';
  });
}

function normalizeItemList(input, prefix, normalizeItem) {
  return asArray(input)
    .map((raw) => normalizeItem(isPlainObject(raw) ? raw : {}, prefix))
    .filter(hasValue);
}

function normalizeBasic(raw) {
  const linksInput = asArray(raw.links);
  return {
    name: asString(raw.name),
    gender: asString(raw.gender),
    birthDate: asString(raw.birthDate),
    phone: asString(raw.phone),
    email: asString(raw.email),
    location: asString(raw.location),
    jobTarget: asString(raw.jobTarget),
    avatarUrl: asString(raw.avatarUrl),
    links: linksInput
      .map((item) => ({
        label: asString(isPlainObject(item) ? item.label : ''),
        url: asString(isPlainObject(item) ? item.url : ''),
      }))
      .filter((link) => link.label.trim() !== '' || link.url.trim() !== ''),
  };
}

function normalizeEducation(raw, prefix) {
  return {
    id: asString(raw.id) || nextId(prefix),
    school: asString(raw.school),
    degree: asString(raw.degree),
    major: asString(raw.major),
    startDate: asString(raw.startDate),
    endDate: asString(raw.endDate),
    description: asString(raw.description),
  };
}

function normalizeWork(raw, prefix) {
  return {
    id: asString(raw.id) || nextId(prefix),
    company: asString(raw.company),
    position: asString(raw.position),
    location: asString(raw.location),
    startDate: asString(raw.startDate),
    endDate: asString(raw.endDate),
    highlights: asStringList(raw.highlights),
  };
}

function normalizeProject(raw, prefix) {
  return {
    id: asString(raw.id) || nextId(prefix),
    name: asString(raw.name),
    role: asString(raw.role),
    startDate: asString(raw.startDate),
    endDate: asString(raw.endDate),
    description: asString(raw.description),
    highlights: asStringList(raw.highlights),
    link: asString(raw.link),
  };
}

function normalizeSkill(raw, prefix) {
  return {
    id: asString(raw.id) || nextId(prefix),
    category: asString(raw.category),
    items: asStringList(raw.items),
    level: asString(raw.level),
  };
}

function normalizeCertificate(raw, prefix) {
  return {
    id: asString(raw.id) || nextId(prefix),
    name: asString(raw.name),
    issuer: asString(raw.issuer),
    date: asString(raw.date),
    description: asString(raw.description),
  };
}

function normalizeSummary(raw) {
  return {
    content: asString(raw.content),
    highlights: asStringList(raw.highlights),
  };
}

function normalizeMeta(raw) {
  const mode = asString(raw.generatedMode);
  const source = asString(raw.configSource);
  return {
    schemaVersion: 1,
    generatedMode: ['ai', 'rule', 'manual'].includes(mode) ? mode : 'manual',
    configSource: ['user', 'env', 'none'].includes(source) ? source : 'none',
    updatedAt: asString(raw.updatedAt),
  };
}

/** 生成一份全新的空结构（避免共享引用被意外修改）。 */
export function createEmptyContent() {
  return JSON.parse(JSON.stringify(EMPTY_CONTENT));
}

/**
 * 深度补全 content_json：对 null / 残缺 / 类型错误的输入一律补齐 7 分区结构且绝不抛错。
 * 未知字段会被丢弃，字符串字段强制转 string，数组元素补 id。
 * @param {unknown} input 任意输入
 * @returns {object} 合法 ContentJson
 */
export function normalizeContent(input) {
  try {
    const root = isPlainObject(input) ? input : {};
    const basicRaw = isPlainObject(root.basic) ? root.basic : {};
    const summaryRaw = isPlainObject(root.summary) ? root.summary : {};
    const metaRaw = isPlainObject(root.meta) ? root.meta : {};
    return {
      basic: normalizeBasic(basicRaw),
      education: normalizeItemList(root.education, 'edu', normalizeEducation),
      work: normalizeItemList(root.work, 'work', normalizeWork),
      project: normalizeItemList(root.project, 'proj', normalizeProject),
      skill: normalizeItemList(root.skill, 'skill', normalizeSkill),
      certificate: normalizeItemList(root.certificate, 'cert', normalizeCertificate),
      summary: normalizeSummary(summaryRaw),
      meta: normalizeMeta(metaRaw),
    };
  } catch {
    // 兜底：任何异常都返回合法空结构，绝不向外抛错。
    return createEmptyContent();
  }
}

/** 供模板缩略图使用的示例内容（已规范化）。 */
export const SAMPLE_CONTENT = normalizeContent(SAMPLE_RAW);
