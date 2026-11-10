/**
 * 简历渲染器（纯展示组件）。
 * props 仅 content + schema：只遍历 schema.sections 并应用 theme/style，
 * 新增模板 = 新增配置，不改本文件代码。
 * 被 P3 模板缩略、P4 编辑实时预览、P7 公开只读页三处复用。
 */
import type { CSSProperties, ReactNode } from 'react';
import type {
  ContentJson,
  TemplateSchema,
  TemplateSection,
  TemplateStyle,
  TemplateTheme,
} from '../types';

interface ResumeRendererProps {
  content: ContentJson;
  schema: TemplateSchema;
}

const DEFAULT_THEME: TemplateTheme = {
  primary: '#2563EB', text: '#1F2937', muted: '#6B7280', bg: '#FFFFFF', accent: '#EFF6FF',
};

const DEFAULT_STYLE: TemplateStyle = {
  fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif',
  baseFontSize: 14,
  lineHeight: 1.6,
  sectionGap: 16,
  radius: 4,
  headerLayout: 'left',
  density: 'normal',
  showAvatar: false,
};

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function joinParts(parts: (string | undefined)[], separator = ' · '): string {
  return parts.filter((part): part is string => hasText(part)).map((part) => part.trim()).join(separator);
}

function dateRange(start: string | undefined, end: string | undefined): string {
  const from = hasText(start) ? String(start).trim() : '';
  const to = hasText(end) ? String(end).trim() : '';
  if (!from && !to) return '';
  return `${from} — ${to || '至今'}`;
}

function paragraphStyle(style: TemplateStyle): CSSProperties {
  return {
    margin: '4px 0 0 0',
    whiteSpace: 'pre-wrap',
    lineHeight: style.lineHeight,
    color: 'inherit',
    fontSize: '0.96em',
  };
}

function bulletList(items: string[] | undefined, style: TemplateStyle): ReactNode {
  const list = (items || []).filter(hasText);
  if (list.length === 0) return null;
  return (
    <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, lineHeight: style.lineHeight }}>
      {list.map((text, index) => (
        <li key={`${index}-${text.slice(0, 8)}`} style={{ marginBottom: 2 }}>{text}</li>
      ))}
    </ul>
  );
}

/** 单条目容器：cards 布局显示强调底色卡片，list 布局显示细分隔线。 */
function entryBox(theme: TemplateTheme, style: TemplateStyle, layout: string): CSSProperties {
  const compact = style.density === 'compact';
  if (layout === 'cards') {
    return {
      background: theme.accent,
      border: `1px solid ${theme.primary}22`,
      borderRadius: style.radius,
      padding: compact ? '8px 10px' : '10px 12px',
      marginBottom: 8,
      breakInside: 'avoid',
    };
  }
  return {
    padding: compact ? '4px 0' : '7px 0',
    borderBottom: '1px dashed #E5E7EB',
    breakInside: 'avoid',
  };
}

function SectionBlock({ section, theme, style, children }: {
  section: TemplateSection;
  theme: TemplateTheme;
  style: TemplateStyle;
  children: ReactNode;
}) {
  if (!children) return null;
  return (
    <section style={{ marginBottom: style.sectionGap }}>
      <h2
        style={{
          fontSize: '1.08em',
          fontWeight: 700,
          color: theme.primary,
          borderBottom: `2px solid ${theme.primary}`,
          paddingBottom: 5,
          margin: '0 0 10px 0',
          letterSpacing: '0.04em',
        }}
      >
        {section.title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

/** 基本信息页头：left / center / banner 三种布局。 */
function renderBasic(content: ContentJson, theme: TemplateTheme, style: TemplateStyle): ReactNode {
  const basic = content?.basic || ({} as ContentJson['basic']);
  const links = (basic.links || []).filter((link) => hasText(link?.url) || hasText(link?.label));
  const details = [
    hasText(basic.gender) ? `性别：${basic.gender}` : '',
    hasText(basic.birthDate) ? `出生：${basic.birthDate}` : '',
    hasText(basic.location) ? `现居：${basic.location}` : '',
    hasText(basic.jobTarget) ? `求职意向：${basic.jobTarget}` : '',
    hasText(basic.email) ? `邮箱：${basic.email}` : '',
    hasText(basic.phone) ? `电话：${basic.phone}` : '',
  ].filter(Boolean);
  const nothing = !hasText(basic.name) && details.length === 0 && links.length === 0;
  if (nothing) return null;

  const isBanner = style.headerLayout === 'banner';
  const isCenter = style.headerLayout === 'center';
  const bannerStyle: CSSProperties = isBanner
    ? { background: theme.accent, borderLeft: `6px solid ${theme.primary}`, padding: '14px 16px', borderRadius: style.radius }
    : {};

  return (
    <header
      style={{
        ...bannerStyle,
        textAlign: isCenter ? 'center' : 'left',
        marginBottom: style.sectionGap + 4,
        display: 'flex',
        flexDirection: isCenter ? 'column' : 'row',
        alignItems: isCenter ? 'center' : 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}
    >
      {style.showAvatar && (
        <div
          aria-label="头像占位"
          style={{
            width: 64, height: 64, borderRadius: style.radius, flexShrink: 0,
            background: theme.primary, color: '#FFFFFF', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 700,
          }}
        >
          {hasText(basic.name) ? basic.name.trim().slice(0, 1) : '简'}
        </div>
      )}
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <h1 style={{ fontSize: '1.9em', margin: 0, color: theme.text, letterSpacing: '0.06em' }}>
          {hasText(basic.name) ? basic.name : '未填写姓名'}
        </h1>
        {details.length > 0 && (
          <div style={{ color: theme.muted, fontSize: '0.9em', marginTop: 6, lineHeight: style.lineHeight }}>
            {details.join('　|　')}
          </div>
        )}
        {links.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: '0.88em' }}>
            {links.map((link, index) => (
              <a
                key={`${link.url}-${index}`}
                href={link.url || '#'}
                target="_blank"
                rel="noreferrer"
                style={{ color: theme.primary, textDecoration: 'none', overflowWrap: 'anywhere' }}
              >
                {link.label || link.url}
              </a>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

function renderEducation(content: ContentJson, theme: TemplateTheme, style: TemplateStyle, layout: string): ReactNode {
  const items = content?.education || [];
  if (items.length === 0) return null;
  return items.map((item) => (
    <div key={item.id || item.school} style={entryBox(theme, style, layout)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '1.02em' }}>{item.school || '未填写学校'}</strong>
        <span style={{ color: theme.muted, fontSize: '0.88em' }}>{dateRange(item.startDate, item.endDate)}</span>
      </div>
      {hasText(joinParts([item.degree, item.major])) && (
        <div style={{ color: theme.primary, fontSize: '0.92em', marginTop: 2 }}>
          {joinParts([item.degree, item.major])}
        </div>
      )}
      {hasText(item.description) && <p style={paragraphStyle(style)}>{item.description}</p>}
    </div>
  ));
}

function renderWork(content: ContentJson, theme: TemplateTheme, style: TemplateStyle, layout: string): ReactNode {
  const items = content?.work || [];
  if (items.length === 0) return null;
  return items.map((item) => (
    <div key={item.id || item.company} style={entryBox(theme, style, layout)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '1.02em' }}>{joinParts([item.company, item.position], ' · ') || '未填写公司'}</strong>
        <span style={{ color: theme.muted, fontSize: '0.88em' }}>{dateRange(item.startDate, item.endDate)}</span>
      </div>
      {hasText(item.location) && (
        <div style={{ color: theme.muted, fontSize: '0.88em', marginTop: 2 }}>{item.location}</div>
      )}
      {bulletList(item.highlights, style)}
    </div>
  ));
}

function renderProject(content: ContentJson, theme: TemplateTheme, style: TemplateStyle, layout: string): ReactNode {
  const items = content?.project || [];
  if (items.length === 0) return null;
  return items.map((item) => (
    <div key={item.id || item.name} style={entryBox(theme, style, layout)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '1.02em' }}>{item.name || '未填写项目名称'}</strong>
        <span style={{ color: theme.muted, fontSize: '0.88em' }}>{dateRange(item.startDate, item.endDate)}</span>
      </div>
      {hasText(joinParts([item.role])) && (
        <div style={{ color: theme.primary, fontSize: '0.92em', marginTop: 2 }}>{item.role}</div>
      )}
      {hasText(item.description) && <p style={paragraphStyle(style)}>{item.description}</p>}
      {bulletList(item.highlights, style)}
      {hasText(item.link) && (
        <a href={item.link} target="_blank" rel="noreferrer" style={{ color: theme.primary, fontSize: '0.86em', overflowWrap: 'anywhere' }}>
          {item.link}
        </a>
      )}
    </div>
  ));
}

function renderSkill(content: ContentJson, theme: TemplateTheme, style: TemplateStyle, layout: string): ReactNode {
  const items = content?.skill || [];
  if (items.length === 0) return null;
  return items.map((item) => (
    <div key={item.id || item.category} style={entryBox(theme, style, layout)}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        {hasText(item.category) && <strong style={{ color: theme.text }}>{item.category}</strong>}
        {hasText(item.level) && <span style={{ color: theme.muted, fontSize: '0.86em' }}>（{item.level}）</span>}
      </div>
      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(item.items || []).filter(hasText).map((skill, index) => (
          <span
            key={`${skill}-${index}`}
            style={{
              background: layout === 'cards' ? theme.bg : theme.accent,
              border: `1px solid ${theme.primary}33`,
              borderRadius: style.radius,
              padding: '2px 8px',
              fontSize: '0.88em',
              color: theme.text,
            }}
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  ));
}

function renderCertificate(content: ContentJson, theme: TemplateTheme, style: TemplateStyle, layout: string): ReactNode {
  const items = content?.certificate || [];
  if (items.length === 0) return null;
  return items.map((item) => (
    <div key={item.id || item.name} style={entryBox(theme, style, layout)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong>{item.name || '未填写证书名称'}</strong>
        <span style={{ color: theme.muted, fontSize: '0.88em' }}>{item.date || ''}</span>
      </div>
      {hasText(joinParts([item.issuer])) && (
        <div style={{ color: theme.muted, fontSize: '0.88em', marginTop: 2 }}>{item.issuer}</div>
      )}
      {hasText(item.description) && <p style={paragraphStyle(style)}>{item.description}</p>}
    </div>
  ));
}

function renderSummary(content: ContentJson, theme: TemplateTheme, style: TemplateStyle): ReactNode {
  const summary = content?.summary || ({ content: '', highlights: [] } as ContentJson['summary']);
  const hasContent = hasText(summary.content);
  const highlights = (summary.highlights || []).filter(hasText);
  if (!hasContent && highlights.length === 0) return null;
  return (
    <div style={{ background: theme.accent, borderRadius: style.radius, padding: '10px 12px' }}>
      {hasContent && <p style={{ ...paragraphStyle(style), margin: 0, whiteSpace: 'pre-wrap' }}>{summary.content}</p>}
      {bulletList(highlights, style)}
    </div>
  );
}

/** 按 key 分派渲染；sections 的顺序与开关完全由 schema 决定。 */
function renderSection(
  section: TemplateSection,
  content: ContentJson,
  theme: TemplateTheme,
  style: TemplateStyle,
): ReactNode {
  switch (section.key) {
    case 'basic':
      return renderBasic(content, theme, style);
    case 'education':
      return renderEducation(content, theme, style, section.layout);
    case 'work':
      return renderWork(content, theme, style, section.layout);
    case 'project':
      return renderProject(content, theme, style, section.layout);
    case 'skill':
      return renderSkill(content, theme, style, section.layout);
    case 'certificate':
      return renderCertificate(content, theme, style, section.layout);
    case 'summary':
      return renderSummary(content, theme, style);
    default:
      // 未知分区直接跳过：新增模板只需新增配置，不改渲染代码。
      return null;
  }
}

/**
 * 渲染 A4 简历。
 * @param content 已规范化的 ContentJson（公开快照可能缺少 email/phone/meta）
 * @param schema 模板 schema_json
 */
export default function ResumeRenderer({ content, schema }: ResumeRendererProps) {
  const theme: TemplateTheme = { ...DEFAULT_THEME, ...(schema?.theme || {}) };
  const style: TemplateStyle = { ...DEFAULT_STYLE, ...(schema?.style || {}) };
  const sections: TemplateSection[] = (schema?.sections || [])
    .filter((section) => section && section.enabled !== false)
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  const rootStyle: CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: `${style.baseFontSize}px`,
    lineHeight: style.lineHeight,
    color: theme.text,
    background: theme.bg,
  };

  return (
    <div className="resume-a4" style={rootStyle}>
      {sections.map((section) => {
        const body = renderSection(section, content || ({} as ContentJson), theme, style);
        if (!body || (Array.isArray(body) && body.length === 0)) return null;
        if (section.key === 'basic') return <div key={section.key}>{body}</div>;
        return (
          <SectionBlock key={section.key} section={section} theme={theme} style={style}>
            {body}
          </SectionBlock>
        );
      })}
    </div>
  );
}
