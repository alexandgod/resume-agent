/**
 * P4 简历编辑 / 预览页：左编辑右预览（移动 Tab 切换）、分区折叠增删改排序、
 * 300ms 防抖实时预览、生成三阶段进度 + 30s 超时、按 5.4 显示来源标识条、
 * 保存 / 另存版本 / 去分享 / 浏览器打印兜底。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  ArrowUpward as UpIcon,
  ArrowDownward as DownIcon,
  Save as SaveIcon,
  ContentCopy as CopyIcon,
  Share as ShareIcon,
  Print as PrintIcon,
  AutoAwesome as GenerateIcon,
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import ResumeRenderer from '../components/ResumeRenderer';
import {
  ErrorState,
  GenerationSourceBar,
  LoadingState,
  PageHeader,
  getErrorMessage,
  useToast,
} from '../components/shell';
import type {
  BasicInfo,
  CertificateItem,
  ContentJson,
  EducationItem,
  GenerateResult,
  ProjectItem,
  ResumeDetail,
  SkillItem,
  Summary,
  Template,
  TemplateSchema,
  WorkItem,
} from '../types';

const CURRENT_RESUME_KEY = 'ra_current_resume_id';
const TEMPLATE_ID_KEY = 'ra_template_id';

type ArraySectionKey = 'education' | 'work' | 'project' | 'skill' | 'certificate';
type EditableItem = EducationItem | WorkItem | ProjectItem | SkillItem | CertificateItem;

const SECTION_LABELS: Record<string, string> = {
  basic: '基本信息',
  education: '教育经历',
  work: '工作经历',
  project: '项目经历',
  skill: '技能专长',
  certificate: '证书荣誉',
  summary: '自我评价',
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const ITEM_FACTORIES: Record<ArraySectionKey, () => EditableItem> = {
  education: () => ({ id: newId('edu'), school: '', degree: '', major: '', startDate: '', endDate: '', description: '' }),
  work: () => ({ id: newId('work'), company: '', position: '', location: '', startDate: '', endDate: '', highlights: [] }),
  project: () => ({ id: newId('proj'), name: '', role: '', startDate: '', endDate: '', description: '', highlights: [], link: '' }),
  skill: () => ({ id: newId('skill'), category: '', items: [], level: '' }),
  certificate: () => ({ id: newId('cert'), name: '', issuer: '', date: '', description: '' }),
};

const STAGES = ['整理资料', '生成内容', '排版预览'];

export default function ResumeEditPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { show } = useToast();

  const [resume, setResume] = useState<ResumeDetail | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [content, setContent] = useState<ContentJson | null>(null);
  const [previewContent, setPreviewContent] = useState<ContentJson | null>(null);
  const [title, setTitle] = useState('我的简历');
  const [status, setStatus] = useState<'draft' | 'final'>('draft');
  const [templateId, setTemplateId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState(0);
  const [generationMode, setGenerationMode] = useState('manual');
  const [configSource, setConfigSource] = useState('none');
  const [degradedReason, setDegradedReason] = useState('');
  const [mobileTab, setMobileTab] = useState(0);

  // 300ms 防抖实时预览。
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewContent(content), 300);
    return () => window.clearTimeout(timer);
  }, [content]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [detail, templateData] = await Promise.all([
        apiFetch<{ resume: ResumeDetail }>(`/resumes/${id}`),
        apiFetch<{ items: Template[] }>('/templates'),
      ]);
      const detailResume = detail.resume;
      setResume(detailResume);
      setContent(detailResume.content);
      setPreviewContent(detailResume.content);
      setTitle(detailResume.title || '我的简历');
      setStatus(detailResume.status || 'draft');
      setTemplateId(detailResume.template_id || '');
      setGenerationMode(detailResume.generation_mode || 'manual');
      setConfigSource(detailResume.config_source || 'none');
      setDegradedReason('');
      setTemplates(templateData.items || []);
      setDirty(false);
      try {
        window.localStorage.setItem(CURRENT_RESUME_KEY, id);
        window.localStorage.setItem(TEMPLATE_ID_KEY, detailResume.template_id || '');
      } catch { /* 忽略存储异常 */ }
    } catch (err) {
      setError(getErrorMessage(err, '简历加载失败'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const activeSchema: TemplateSchema | null = useMemo(() => {
    const found = templates.find((item) => item.id === templateId);
    return found?.schema_json || resume?.template || null;
  }, [templates, templateId, resume]);

  const mutateList = (key: ArraySectionKey, mutate: (list: EditableItem[]) => EditableItem[]) => {
    setContent((prev) => {
      if (!prev) return prev;
      const next: ContentJson = { ...prev };
      const current = (prev[key] || []) as unknown as EditableItem[];
      Object.assign(next, { [key]: mutate([...current]) });
      return next;
    });
    setDirty(true);
  };

  const updateItem = (key: ArraySectionKey, index: number, patch: Partial<EditableItem>) => {
    mutateList(key, (list) => list.map((item, i) => (
      i === index ? ({ ...item, ...patch } as EditableItem) : item
    )));
  };

  const updateBasic = (patch: Partial<BasicInfo>) => {
    setContent((prev) => (prev ? { ...prev, basic: { ...prev.basic, ...patch } } : prev));
    setDirty(true);
  };

  const updateSummary = (patch: Partial<Summary>) => {
    setContent((prev) => (prev ? { ...prev, summary: { ...prev.summary, ...patch } } : prev));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!content) return;
    setSaving(true);
    try {
      const data = await apiFetch<{ resume: ResumeDetail }>(`/resumes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, templateId, content, status }),
      });
      setResume(data.resume);
      setContent(data.resume.content);
      setDirty(false);
      show('已保存', 'success');
    } catch (err) {
      show(getErrorMessage(err, '保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      const data = await apiFetch<{ resume: ResumeDetail }>(`/resumes/${id}/copy`, {
        method: 'POST',
        body: JSON.stringify({ title: `${title}（副本）` }),
      });
      show('已另存为新版本', 'success');
      navigate(`/resumes/${data.resume.id}/edit`);
    } catch (err) {
      show(getErrorMessage(err, '另存失败'), 'error');
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setStage(0);
    setDegradedReason('');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);
    const stageTimers = [
      window.setTimeout(() => setStage(1), 600),
      window.setTimeout(() => setStage(2), 1800),
    ];
    try {
      const result = await apiFetch<GenerateResult>(`/resumes/${id}/generate`, {
        method: 'POST',
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      setContent(result.resume.content);
      setPreviewContent(result.resume.content);
      setGenerationMode(result.generationMode);
      setConfigSource(result.configSource);
      setDegradedReason(result.degradedReason || '');
      setDirty(false);
      if (result.generationMode === 'rule') {
        show(result.degradedReason || '当前为规则化生成，简历已生成，可继续手动完善', 'warning');
      } else {
        show('AI 生成完成', 'success');
      }
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError'
        ? '生成超过 30 秒已取消，请检查模型配置或稍后重试'
        : getErrorMessage(err, '生成失败，请稍后重试');
      show(message, 'error');
    } finally {
      window.clearTimeout(timeoutId);
      stageTimers.forEach((timer) => window.clearTimeout(timer));
      setGenerating(false);
    }
  };

  const handleTemplateChange = async (nextTemplateId: string) => {
    const previous = templateId;
    setTemplateId(nextTemplateId);
    try {
      await apiFetch(`/resumes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ templateId: nextTemplateId }),
      });
      try { window.localStorage.setItem(TEMPLATE_ID_KEY, nextTemplateId); } catch { /* 忽略 */ }
      show('模板已切换，简历内容保持不变', 'success');
    } catch (err) {
      setTemplateId(previous);
      show(getErrorMessage(err, '切换模板失败'), 'error');
    }
  };

  /** 通用数组条目编辑字段。 */
  const renderItemFields = (key: ArraySectionKey, item: EditableItem, index: number) => {
    const patch = (value: Partial<EditableItem>) => updateItem(key, index, value);
    const field = (label: string, value: string, onChange: (next: string) => void, multiline = false) => (
      <TextField
        key={label} fullWidth size="small" margin="dense" label={label} value={value}
        onChange={(event) => onChange(event.target.value)}
        multiline={multiline} minRows={multiline ? 2 : undefined}
        inputProps={{ 'aria-label': label }}
      />
    );
    switch (key) {
      case 'education': {
        const row = item as EducationItem;
        return (
          <Grid container spacing={1}>
            <Grid item xs={12} sm={6}>{field('学校', row.school, (v) => patch({ school: v }))}</Grid>
            <Grid item xs={6} sm={3}>{field('学历', row.degree, (v) => patch({ degree: v }))}</Grid>
            <Grid item xs={6} sm={3}>{field('专业', row.major, (v) => patch({ major: v }))}</Grid>
            <Grid item xs={6} sm={3}>{field('开始时间', row.startDate, (v) => patch({ startDate: v }))}</Grid>
            <Grid item xs={6} sm={3}>{field('结束时间', row.endDate, (v) => patch({ endDate: v }))}</Grid>
            <Grid item xs={12}>{field('描述', row.description, (v) => patch({ description: v }), true)}</Grid>
          </Grid>
        );
      }
      case 'work': {
        const row = item as WorkItem;
        return (
          <Grid container spacing={1}>
            <Grid item xs={12} sm={6}>{field('公司', row.company, (v) => patch({ company: v }))}</Grid>
            <Grid item xs={12} sm={6}>{field('职位', row.position, (v) => patch({ position: v }))}</Grid>
            <Grid item xs={6} sm={3}>{field('地点', row.location, (v) => patch({ location: v }))}</Grid>
            <Grid item xs={6} sm={3}>{field('开始时间', row.startDate, (v) => patch({ startDate: v }))}</Grid>
            <Grid item xs={6} sm={3}>{field('结束时间', row.endDate, (v) => patch({ endDate: v }))}</Grid>
            <Grid item xs={12}>
              {field('工作亮点（每行一条）', (row.highlights || []).join('\n'), (v) => patch({ highlights: v.split('\n').map((s) => s.trim()).filter(Boolean) }), true)}
            </Grid>
          </Grid>
        );
      }
      case 'project': {
        const row = item as ProjectItem;
        return (
          <Grid container spacing={1}>
            <Grid item xs={12} sm={6}>{field('项目名称', row.name, (v) => patch({ name: v }))}</Grid>
            <Grid item xs={12} sm={6}>{field('担任角色', row.role, (v) => patch({ role: v }))}</Grid>
            <Grid item xs={6} sm={3}>{field('开始时间', row.startDate, (v) => patch({ startDate: v }))}</Grid>
            <Grid item xs={6} sm={3}>{field('结束时间', row.endDate, (v) => patch({ endDate: v }))}</Grid>
            <Grid item xs={12}>{field('项目链接', row.link, (v) => patch({ link: v }))}</Grid>
            <Grid item xs={12}>{field('描述', row.description, (v) => patch({ description: v }), true)}</Grid>
            <Grid item xs={12}>
              {field('亮点（每行一条）', (row.highlights || []).join('\n'), (v) => patch({ highlights: v.split('\n').map((s) => s.trim()).filter(Boolean) }), true)}
            </Grid>
          </Grid>
        );
      }
      case 'skill': {
        const row = item as SkillItem;
        return (
          <Grid container spacing={1}>
            <Grid item xs={12} sm={5}>{field('分类', row.category, (v) => patch({ category: v }))}</Grid>
            <Grid item xs={12} sm={4}>{field('熟练度', row.level, (v) => patch({ level: v }))}</Grid>
            <Grid item xs={12}>{field('技能项（逗号或顿号分隔）', (row.items || []).join('、'), (v) => patch({ items: v.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean) }))}</Grid>
          </Grid>
        );
      }
      case 'certificate': {
        const row = item as CertificateItem;
        return (
          <Grid container spacing={1}>
            <Grid item xs={12} sm={6}>{field('证书名称', row.name, (v) => patch({ name: v }))}</Grid>
            <Grid item xs={12} sm={6}>{field('颁发机构', row.issuer, (v) => patch({ issuer: v }))}</Grid>
            <Grid item xs={12} sm={6}>{field('获得时间', row.date, (v) => patch({ date: v }))}</Grid>
            <Grid item xs={12}>{field('说明', row.description, (v) => patch({ description: v }), true)}</Grid>
          </Grid>
        );
      }
      default:
        return null;
    }
  };

  const renderArraySection = (key: ArraySectionKey) => {
    const list = ((content?.[key] || []) as unknown as EditableItem[]);
    return (
      <Accordion key={key} defaultExpanded={key === 'education' || key === 'work'} disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={700}>{SECTION_LABELS[key]}（{list.length}）</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {list.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>暂无条目，点击下方「新增」添加。</Typography>
          )}
          {list.map((item, index) => (
            <Box key={item.id || index} sx={{ border: '1px solid #E5E7EB', borderRadius: 1, p: 1.5, mb: 1.5 }}>
              <Stack direction="row" spacing={0.5} sx={{ mb: 1, justifyContent: 'flex-end' }}>
                <Tooltip title="上移"><span><IconButton aria-label="上移" size="small" disabled={index === 0} onClick={() => mutateList(key, (rows) => { const copy = [...rows]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })}><UpIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title="下移"><span><IconButton aria-label="下移" size="small" disabled={index === list.length - 1} onClick={() => mutateList(key, (rows) => { const copy = [...rows]; [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]]; return copy; })}><DownIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title="删除条目"><IconButton aria-label="删除条目" size="small" color="error" onClick={() => mutateList(key, (rows) => rows.filter((_, i) => i !== index))}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
              </Stack>
              {renderItemFields(key, item, index)}
            </Box>
          ))}
          <Button
            variant="outlined" startIcon={<AddIcon />} sx={{ minHeight: 44 }}
            onClick={() => mutateList(key, (rows) => [...rows, ITEM_FACTORIES[key]()])}
          >
            新增{SECTION_LABELS[key]}
          </Button>
        </AccordionDetails>
      </Accordion>
    );
  };

  const renderEditor = () => {
    if (!content) return null;
    const basic = content.basic;
    const links = basic.links || [];
    return (
      <Box>
        <Accordion defaultExpanded disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={700}>基本信息</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={1}>
              {([
                ['姓名', basic.name, (v: string) => updateBasic({ name: v })],
                ['性别', basic.gender, (v: string) => updateBasic({ gender: v })],
                ['出生日期', basic.birthDate, (v: string) => updateBasic({ birthDate: v })],
                ['手机号', basic.phone, (v: string) => updateBasic({ phone: v })],
                ['邮箱', basic.email, (v: string) => updateBasic({ email: v })],
                ['现居地', basic.location, (v: string) => updateBasic({ location: v })],
                ['求职意向', basic.jobTarget, (v: string) => updateBasic({ jobTarget: v })],
              ] as [string, string, (v: string) => void][]).map(([label, value, onChange]) => (
                <Grid item xs={12} sm={6} key={label}>
                  <TextField fullWidth size="small" margin="dense" label={label} value={value || ''}
                    onChange={(event) => onChange(event.target.value)} inputProps={{ 'aria-label': label }} />
                </Grid>
              ))}
            </Grid>
            <Typography variant="subtitle2" sx={{ mt: 1.5, mb: 0.5 }}>个人链接</Typography>
            {links.map((link, index) => (
              <Stack direction="row" spacing={1} key={`${link.url}-${index}`} sx={{ mb: 1, flexWrap: 'wrap' }}>
                <TextField size="small" label="名称" value={link.label || ''} sx={{ flex: '1 1 120px' }}
                  onChange={(event) => updateBasic({ links: links.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })}
                  inputProps={{ 'aria-label': '链接名称' }} />
                <TextField size="small" label="地址" value={link.url || ''} sx={{ flex: '2 1 220px' }}
                  onChange={(event) => updateBasic({ links: links.map((item, i) => i === index ? { ...item, url: event.target.value } : item) })}
                  inputProps={{ 'aria-label': '链接地址' }} />
                <IconButton aria-label="删除链接" color="error" onClick={() => updateBasic({ links: links.filter((_, i) => i !== index) })}><DeleteIcon fontSize="small" /></IconButton>
              </Stack>
            ))}
            <Button variant="outlined" startIcon={<AddIcon />} sx={{ minHeight: 44 }}
              onClick={() => updateBasic({ links: [...links, { label: '', url: '' }] })}>新增链接</Button>
          </AccordionDetails>
        </Accordion>

        {(['education', 'work', 'project', 'skill', 'certificate'] as ArraySectionKey[]).map(renderArraySection)}

        <Accordion defaultExpanded disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={700}>自我评价</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TextField fullWidth multiline minRows={4} label="自我评价正文" value={content.summary.content || ''}
              onChange={(event) => updateSummary({ content: event.target.value })}
              inputProps={{ 'aria-label': '自我评价正文' }} />
            <TextField fullWidth multiline minRows={2} label="亮点（每行一条）" sx={{ mt: 2 }}
              value={(content.summary.highlights || []).join('\n')}
              onChange={(event) => updateSummary({ highlights: event.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
              inputProps={{ 'aria-label': '自评亮点' }} />
          </AccordionDetails>
        </Accordion>
      </Box>
    );
  };

  if (loading) return <LoadingState message="正在加载简历…" />;
  if (error || !resume || !content || !activeSchema) {
    return <ErrorState message={error || '简历数据不完整'} onRetry={() => { void load(); }} />;
  }

  const actions = (
    <>
      {dirty && <Chip label="有未保存修改" color="warning" size="small" />}
      <Button variant="contained" startIcon={<GenerateIcon />} disabled={generating} onClick={() => { void handleGenerate(); }} sx={{ minHeight: 44 }}>
        一键生成
      </Button>
      <Button variant="outlined" startIcon={<SaveIcon />} disabled={saving} onClick={() => { void handleSave(); }} sx={{ minHeight: 44 }}>
        {saving ? '保存中…' : '保存'}
      </Button>
      <Button variant="outlined" startIcon={<CopyIcon />} onClick={() => { void handleCopy(); }} sx={{ minHeight: 44 }}>另存版本</Button>
      <Button variant="outlined" startIcon={<ShareIcon />} onClick={() => navigate(`/resumes/${id}/share`)} sx={{ minHeight: 44 }}>去分享</Button>
      <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()} sx={{ minHeight: 44 }}>打印 / 另存 PDF</Button>
    </>
  );

  return (
    <Box className="ra-page">
      <div className="ra-no-print">
        <PageHeader title="编辑简历" description="左侧编辑、右侧实时预览；修改内容与来源标识保持一致。" actions={actions} />
        <Stack spacing={1.5} sx={{ mb: 2 }}>
          <Grid container spacing={1.5} alignItems="center">
            <Grid item xs={12} sm={4}>
              <TextField fullWidth size="small" label="简历标题" value={title}
                onChange={(event) => { setTitle(event.target.value); setDirty(true); }}
                inputProps={{ 'aria-label': '简历标题' }} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField select fullWidth size="small" label="状态" value={status}
                onChange={(event) => { setStatus(event.target.value as 'draft' | 'final'); setDirty(true); }}
                inputProps={{ 'aria-label': '简历状态' }}>
                <MenuItem value="draft">草稿</MenuItem>
                <MenuItem value="final">定稿</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={6} sm={5}>
              <TextField select fullWidth size="small" label="模板（切换不丢内容）" value={templateId}
                onChange={(event) => { void handleTemplateChange(event.target.value); }}
                inputProps={{ 'aria-label': '简历模板' }}>
                {templates.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
              </TextField>
            </Grid>
          </Grid>
          <GenerationSourceBar
            generationMode={generationMode}
            configSource={configSource}
            degradedReason={degradedReason}
          />
          {generationMode === 'rule' && (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              当前为规则化生成：未配置密钥或配置调用失败时自动启用，结果仍可手动编辑、保存与分享。
            </Alert>
          )}
        </Stack>
      </div>

      {isMobile && (
        <Tabs value={mobileTab} onChange={(_, value: number) => setMobileTab(value)} variant="fullWidth" className="ra-no-print" sx={{ mb: 1.5, minHeight: 44 }}>
          <Tab label="编辑" sx={{ minHeight: 44 }} />
          <Tab label="预览" sx={{ minHeight: 44 }} />
        </Tabs>
      )}

      <Grid container spacing={2}>
        {(!isMobile || mobileTab === 0) && (
          <Grid item xs={12} md={5} className="ra-no-print">
            {renderEditor()}
          </Grid>
        )}
        {(!isMobile || mobileTab === 1) && (
          <Grid item xs={12} md={7}>
            <Box className="ra-scroll-x" sx={{ width: '100%' }}>
              {previewContent ? (
                <ResumeRenderer content={previewContent} schema={activeSchema} />
              ) : (
                <LoadingState message="正在渲染预览…" />
              )}
            </Box>
          </Grid>
        )}
      </Grid>

      {/* 生成进度：三阶段文案 + 进度条 */}
      <Dialog open={generating} fullWidth maxWidth="xs" disableEscapeKeyDown>
        <DialogTitle sx={{ fontWeight: 700 }}>正在生成简历</DialogTitle>
        <DialogContent>
          <LinearProgress sx={{ mb: 2 }} />
          {STAGES.map((text, index) => (
            <Stack direction="row" spacing={1} alignItems="center" key={text} sx={{ mb: 1 }}>
              <Chip label={index + 1} size="small" color={index <= stage ? 'primary' : 'default'} />
              <Typography variant="body2" color={index <= stage ? 'text.primary' : 'text.secondary'}>{text}</Typography>
              {index === stage && <Typography variant="caption" color="primary">进行中…</Typography>}
            </Stack>
          ))}
          <Typography variant="caption" color="text.secondary">
            最长等待 30 秒；无可用密钥时自动使用本地规则化生成，不会中断。
          </Typography>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
