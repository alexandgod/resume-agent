/**
 * 规则化简历生成器（AC-01 底线）。
 * 纯本地、零网络请求：正则抽取邮箱/手机/日期，教育/公司/职位/技能关键词词库，
 * 按行分段填充 7 个分区，任何输入都 100% 产出可读的合法 ContentJson。
 * 无配置、配置调用失败/超时/非法 JSON 时由 aiService 直接降级到此生成器。
 */
import { normalizeContent } from '../domain/contentSchema.js';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?86[- ]?)?1[3-9]\d{9}/;
const URL_RE = /https?:\/\/[^\s，。；）)\]]+/g;
const DATE_RE = /(?:19|20)\d{2}\s*[-/.年]\s*\d{1,2}(?:\s*[-/.月]\s*\d{1,2}\s*日?)?/g;

const SKILL_WORDS = [
  'JavaScript', 'TypeScript', 'React', 'Vue', 'Angular', 'Node.js', 'Python', 'Java',
  'Golang', 'Go', 'C++', 'C#', 'PHP', 'Ruby', 'Swift', 'Kotlin', 'SQL', 'MySQL',
  'PostgreSQL', 'MongoDB', 'Redis', 'Docker', 'Kubernetes', 'Git', 'HTML', 'CSS',
  'Sass', 'Tailwind', 'Webpack', 'Vite', 'Figma', 'Sketch', 'Photoshop', 'Excel',
  'PowerPoint', 'Linux', 'Nginx', '微服务', 'Spring', 'Django', 'Flask', 'Express',
  'GraphQL', 'Flutter', 'React Native', '数据分析', '项目管理', '产品设计',
  '用户研究', '机器学习', '深度学习', '沟通协作', '文档写作', '小程序', 'uni-app',
];

const DEGREE_WORDS = ['博士', '硕士', '研究生', '本科', '学士', '大专', '专科', '高中'];
const POSITION_WORDS = [
  '工程师', '架构师', '经理', '总监', '主管', '设计师', '产品经理', '运营', '分析师',
  '开发', '实习', '负责人', '顾问', '讲师', '研究员', '测试', '运维', '编辑', '策划',
];

const SECTION_HEADER_MAP = [
  { key: 'education', re: /^(教育经历|教育背景|教育|学历|学习经历)[:：]?$/ },
  { key: 'work', re: /^(工作经历|实习经历|工作经历与项目|职业经历|任职经历)[:：]?$/ },
  { key: 'project', re: /^(项目经历|项目经验|代表作品|作品集|项目)[:：]?$/ },
  { key: 'skill', re: /^(技能专长|专业技能|技能|技术栈|能力标签)[:：]?$/ },
  { key: 'certificate', re: /^(证书荣誉|资格证书|证书|荣誉|获奖情况)[:：]?$/ },
  { key: 'summary', re: /^(自我评价|个人简介|自我介绍|自述|职业概述|总结|优势)[:：]?$/ },
  { key: 'basic', re: /^(基本信息|个人资料|关于我|联系方式)[:：]?$/ },
];

const CLASSIFY_RULES = [
  {
    key: 'certificate',
    re: /(证书|认证|获奖|荣誉|CET[- ]?\d?|雅思|托福|CPA|PMP|竞赛|奖学金|资格证)/i,
  },
  {
    key: 'education',
    re: /(大学|学院|学校|本科|硕士|博士|大专|研究生|学士|学历|专业|GPA|主修)/i,
  },
  {
    key: 'skill',
    re: /(技能|技术栈|熟练|掌握|精通|框架|工具|语言能力)/i,
  },
  {
    key: 'project',
    re: /(项目|作品|系统|平台|小程序|重构|上线|独立开发|从 0 到 1)/i,
  },
  {
    key: 'work',
    re: /(有限公司|股份|集团|公司|任职|实习|岗位职责|负责|主导|工程师|经理|总监|主管|设计师|产品经理|运营|团队)/i,
  },
  { key: 'summary', re: /(自我评价|自我介绍|个人简介|自述|优势|性格|总结)/i },
];

let idSeed = 0;

function nextId(prefix) {
  idSeed += 1;
  return `rule-${prefix}-${Date.now().toString(36)}-${idSeed.toString(36)}`;
}

function firstMatch(text, regex) {
  const match = String(text || '').match(regex);
  return match ? match[0].trim() : '';
}

function datesIn(text) {
  return String(text || '').match(DATE_RE) || [];
}

function cleanLine(line) {
  return String(line || '')
    .replace(/^[\s•·▪◦\-*>①②③④⑤⑥⑦⑧⑨⑩\d.、]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 生成结构化简历。
 * @param {string[] | string} texts 已解析的资料文本集合
 * @returns {object} 合法 ContentJson
 */
export function ruleBasedGenerate(texts) {
  const parts = Array.isArray(texts) ? texts : [texts];
  const raw = parts.map((item) => String(item || '')).join('\n');
  const lines = raw
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length > 0);

  // 1) 基本信息：正则抽取
  const email = firstMatch(raw, EMAIL_RE);
  const phone = firstMatch(raw, PHONE_RE);
  const nameFromLabel = /(?:姓名|名字)\s*[:：]\s*([^\s,，;；]{2,12})/.exec(raw);
  let name = nameFromLabel ? nameFromLabel[1] : '';
  if (!name) {
    const candidate = lines.find(
      (line) => /^[\u4e00-\u9fa5]{2,5}$/.test(line) && !/(大学|学院|公司|项目|技能|证书|评价)/.test(line),
    );
    name = candidate || '';
  }
  const targetMatch = /(?:求职意向|意向岗位|目标岗位|应聘岗位|期望职位|应聘职位)\s*[:：]?\s*([^\n,，;；]{2,30})/.exec(raw);
  const locationMatch = /(?:现居|居住地|所在城市|城市|籍贯)\s*[:：]?\s*([^\n,，;；]{2,20})/.exec(raw);
  const birthMatch = /(?:出生|生日|出生年月)\s*[:：]?\s*((?:19|20)\d{2}\s*[-/.年]\s*\d{1,2})/.exec(raw);
  const allDates = datesIn(raw);
  const links = (raw.match(URL_RE) || []).slice(0, 5).map((url, index) => {
    let label = `链接 ${index + 1}`;
    try {
      label = new URL(url).hostname.replace(/^www\./, '') || label;
    } catch {
      // 保留默认标签
    }
    return { label, url };
  });

  // 2) 按行分派到 7 个分区
  /** @type {{section: string, text: string}[]} */
  const buckets = [];
  let currentSection = 'auto';
  for (const line of lines) {
    const header = SECTION_HEADER_MAP.find((item) => item.re.test(line));
    if (header) {
      currentSection = header.key;
      continue;
    }
    if (/^(姓名|名字|电话|手机|邮箱|E-?mail|现居|居住地|求职意向|意向岗位|出生|生日)\s*[:：]/.test(line)) {
      continue;
    }
    let section = currentSection;
    if (section === 'auto') {
      const matched = CLASSIFY_RULES.find((rule) => rule.re.test(line));
      section = matched ? matched.key : 'summary';
    }
    buckets.push({ section, text: line });
  }

  const pick = (key) => buckets.filter((item) => item.section === key).map((item) => item.text).slice(0, 30);

  // 3) 教育经历
  const education = pick('education').slice(0, 10).map((text) => {
    const schoolMatch = /([^\s,，;；]{2,24}(?:大学|学院|学校|中学))/.exec(text);
    const degree = DEGREE_WORDS.find((word) => text.includes(word)) || '';
    const majorMatch = /(?:专业|主修)\s*[:：]?\s*([^\s,，;；]{2,20})/.exec(text);
    const dates = datesIn(text);
    return {
      id: nextId('edu'),
      school: schoolMatch ? schoolMatch[1] : text.slice(0, 30),
      degree,
      major: majorMatch ? majorMatch[1] : '',
      startDate: dates[0] || '',
      endDate: dates[1] || '',
      description: schoolMatch || majorMatch ? text.slice(0, 120) : '',
    };
  });

  // 4) 工作经历：公司/职位行开新条目，其余作为亮点归入上一条
  const work = [];
  for (const text of pick('work').slice(0, 20)) {
    const dates = datesIn(text);
    const companyMatch = /([^\s,，;；]{2,30}(?:有限公司|股份公司|集团|公司|科技|工作室))/.exec(text);
    const position = POSITION_WORDS.find((word) => text.includes(word)) || '';
    if (companyMatch || work.length === 0) {
      work.push({
        id: nextId('work'),
        company: companyMatch ? companyMatch[1] : '',
        position,
        location: '',
        startDate: dates[0] || '',
        endDate: dates[1] || '',
        highlights: companyMatch ? [] : [text.slice(0, 160)],
      });
    } else if (work[work.length - 1].highlights.length < 8) {
      work[work.length - 1].highlights.push(text.slice(0, 160));
    }
  }

  // 5) 项目经历
  const project = pick('project').slice(0, 12).map((text, index) => {
    const dates = datesIn(text);
    return {
      id: nextId('proj'),
      name: text.replace(/^(项目名称|项目)\s*[:：]?\s*/, '').slice(0, 40) || `项目 ${index + 1}`,
      role: POSITION_WORDS.find((word) => text.includes(word)) || '',
      startDate: dates[0] || '',
      endDate: dates[1] || '',
      description: text.slice(0, 220),
      highlights: [],
      link: (text.match(URL_RE) || [])[0] || '',
    };
  });

  // 6) 技能：词库命中 + 分区内文本
  const lowered = raw.toLowerCase();
  const skillHits = SKILL_WORDS.filter((word) => lowered.includes(word.toLowerCase()));
  const skillTexts = pick('skill');
  const skill = [];
  if (skillHits.length > 0) {
    skill.push({ id: nextId('skill'), category: '专业技能', items: skillHits.slice(0, 20), level: '熟练' });
  }
  for (const text of skillTexts.slice(0, 6)) {
    const categoryMatch = /^([^:：]{1,10})\s*[:：]\s*(.+)$/.exec(text);
    const items = String(categoryMatch ? categoryMatch[2] : text)
      .split(/[、,，/|；;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (items.length === 0) continue;
    skill.push({
      id: nextId('skill'),
      category: categoryMatch ? categoryMatch[1].trim() : '其他能力',
      items,
      level: '',
    });
  }

  // 7) 证书
  const certificate = pick('certificate').slice(0, 12).map((text) => {
    const dates = datesIn(text);
    return {
      id: nextId('cert'),
      name: text.slice(0, 60),
      issuer: '',
      date: dates[0] || '',
      description: '',
    };
  });

  // 8) 自评：优先取 summary 分区文本，不足时给出可读的生成说明
  const summaryLines = pick('summary');
  let summaryContent = summaryLines.join('\n').slice(0, 1200);
  if (!summaryContent.trim()) {
    const filled = [
      name ? `姓名：${name}` : '',
      targetMatch ? `求职意向：${targetMatch[1].trim()}` : '',
      `共整理 ${lines.length} 条资料信息`,
      education.length ? `教育经历 ${education.length} 条` : '',
      work.length ? `工作经历 ${work.length} 条` : '',
      project.length ? `项目经历 ${project.length} 条` : '',
    ].filter(Boolean).join('；');
    summaryContent = `${filled}。当前为规则化生成（未调用大模型），请在预览中手动补充完善。`;
  }
  const summary = {
    content: summaryContent,
    highlights: summaryLines
      .filter((line) => /^[•·▪\-*>①②③④⑤⑥]/.test(line) || line.length <= 30)
      .slice(0, 6),
  };

  const basic = {
    name,
    gender: /性别\s*[:：]\s*(男|女)/.exec(raw)?.[1] || '',
    birthDate: birthMatch ? birthMatch[1].replace(/\s/g, '') : (allDates[0] || ''),
    phone,
    email,
    location: locationMatch ? locationMatch[1].trim() : '',
    jobTarget: targetMatch ? targetMatch[1].trim() : '',
    avatarUrl: '',
    links,
  };

  return normalizeContent({
    basic,
    education,
    work,
    project,
    skill,
    certificate,
    summary,
    meta: { schemaVersion: 1, generatedMode: 'rule', configSource: 'none', updatedAt: '' },
  });
}
