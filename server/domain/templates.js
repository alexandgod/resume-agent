/**
 * 3 套内置模板（3.4 节逐值照抄）。
 * schema_json 驱动唯一 ResumeRenderer：新增模板 = 新增一条配置，不改渲染代码。
 * preview_url 固定空串，缩略图由前端用 SAMPLE_CONTENT 渲染，不引入图片资源。
 */

/** 内置模板配置（字段名、颜色、字号、分区顺序均与设计文档一致）。 */
export const BUILTIN_TEMPLATES = [
  {
    code: 'simple', name: '简约', description: '清爽通用，适合应届生与大多数岗位',
    tags: ['通用', '应届生'], preview_url: '', is_builtin: 1, sort_order: 1, status: 'active',
    schema_json: {
      code: 'simple', name: '简约', description: '清爽通用，适合应届生与大多数岗位',
      tags: ['通用', '应届生'], preview_url: '',
      theme: { primary: '#2563EB', text: '#1F2937', muted: '#6B7280', bg: '#FFFFFF', accent: '#EFF6FF' },
      style: {
        fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif', baseFontSize: 14,
        lineHeight: 1.6, sectionGap: 16, radius: 4, headerLayout: 'left',
        density: 'normal', showAvatar: false,
      },
      sections: [
        { key: 'basic', title: '基本信息', enabled: true, order: 1, layout: 'inline' },
        { key: 'education', title: '教育经历', enabled: true, order: 2, layout: 'list' },
        { key: 'work', title: '工作经历', enabled: true, order: 3, layout: 'list' },
        { key: 'project', title: '项目经历', enabled: true, order: 4, layout: 'list' },
        { key: 'skill', title: '技能专长', enabled: true, order: 5, layout: 'cards' },
        { key: 'certificate', title: '证书荣誉', enabled: true, order: 6, layout: 'list' },
        { key: 'summary', title: '自我评价', enabled: true, order: 7, layout: 'text' },
      ],
    },
  },
  {
    code: 'pro', name: '专业', description: '稳重深蓝，工作经历优先，适合社招与中高级岗位',
    tags: ['社招', '管理岗'], preview_url: '', is_builtin: 1, sort_order: 2, status: 'active',
    schema_json: {
      code: 'pro', name: '专业', description: '稳重深蓝，工作经历优先，适合社招与中高级岗位',
      tags: ['社招', '管理岗'], preview_url: '',
      theme: { primary: '#1E3A5F', text: '#111827', muted: '#6B7280', bg: '#FFFFFF', accent: '#E8EEF6' },
      style: {
        fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif', baseFontSize: 13.5,
        lineHeight: 1.55, sectionGap: 14, radius: 2, headerLayout: 'center',
        density: 'compact', showAvatar: true,
      },
      sections: [
        { key: 'basic', title: '基本信息', enabled: true, order: 1, layout: 'inline' },
        { key: 'summary', title: '职业概述', enabled: true, order: 2, layout: 'text' },
        { key: 'work', title: '工作经历', enabled: true, order: 3, layout: 'list' },
        { key: 'project', title: '项目经历', enabled: true, order: 4, layout: 'list' },
        { key: 'education', title: '教育背景', enabled: true, order: 5, layout: 'list' },
        { key: 'skill', title: '专业技能', enabled: true, order: 6, layout: 'cards' },
        { key: 'certificate', title: '资格证书', enabled: true, order: 7, layout: 'list' },
      ],
    },
  },
  {
    code: 'creative', name: '创意', description: '紫色强调色与卡片布局，适合设计、内容与创意岗位',
    tags: ['设计', '创意'], preview_url: '', is_builtin: 1, sort_order: 3, status: 'active',
    schema_json: {
      code: 'creative', name: '创意', description: '紫色强调色与卡片布局，适合设计、内容与创意岗位',
      tags: ['设计', '创意'], preview_url: '',
      theme: { primary: '#7C3AED', text: '#1F2937', muted: '#7C7C8A', bg: '#FFFFFF', accent: '#F5F3FF' },
      style: {
        fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif', baseFontSize: 15,
        lineHeight: 1.7, sectionGap: 20, radius: 12, headerLayout: 'banner',
        density: 'normal', showAvatar: true,
      },
      sections: [
        { key: 'basic', title: '关于我', enabled: true, order: 1, layout: 'inline' },
        { key: 'skill', title: '能力标签', enabled: true, order: 2, layout: 'cards' },
        { key: 'project', title: '代表作品', enabled: true, order: 3, layout: 'cards' },
        { key: 'work', title: '经历', enabled: true, order: 4, layout: 'list' },
        { key: 'education', title: '教育', enabled: true, order: 5, layout: 'list' },
        { key: 'certificate', title: '荣誉', enabled: true, order: 6, layout: 'list' },
        { key: 'summary', title: '自述', enabled: true, order: 7, layout: 'text' },
      ],
    },
  },
];

/**
 * 幂等写入内置模板（启动时调用）。
 * 已存在的 code 不重复写入，重复启动不产生重复数据。
 * @param {object} repo Repository 实例
 * @returns {Promise<number>} 当前模板总数
 */
export async function seedTemplates(repo) {
  const existing = await repo.find('templates');
  const codes = new Set(existing.map((item) => item.code));
  for (const template of BUILTIN_TEMPLATES) {
    if (codes.has(template.code)) continue;
    await repo.insert('templates', {
      code: template.code,
      name: template.name,
      preview_url: template.preview_url,
      schema_json: template.schema_json,
      is_builtin: template.is_builtin,
      sort_order: template.sort_order,
      status: template.status,
    });
    codes.add(template.code);
  }
  return repo.count('templates');
}
