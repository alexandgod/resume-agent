/**
 * P3 模板选择页：网格卡片、缩略预览（用 SAMPLE_CONTENT 由 ResumeRenderer 渲染，不引入图片）、
 * 预览弹窗、使用此模板、当前模板角标、切换内容不丢失提示。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { CheckCircle as CheckIcon, Visibility as PreviewIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import ResumeRenderer from '../components/ResumeRenderer';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  getErrorMessage,
  useToast,
} from '../components/shell';
import type { ContentJson, ResumeDetail, Template } from '../types';
// @ts-ignore —— contentSchema.js 为前后端同构的纯 JS 模块（不引入任何 node: 内置模块）
import { SAMPLE_CONTENT } from '../../server/domain/contentSchema.js';

const TEMPLATE_ID_KEY = 'ra_template_id';
const CURRENT_RESUME_KEY = 'ra_current_resume_id';

/** 用示例内容渲染缩略图：A4 内容固定宽度后整体缩放。 */
function TemplateThumb({ schema }: { schema: Template['schema_json'] }) {
  return (
    <Box
      sx={{
        height: 236, overflow: 'hidden', border: '1px solid #E5E7EB',
        borderRadius: 2, background: '#FFFFFF', position: 'relative',
      }}
    >
      <Box sx={{ width: 794, transform: 'scale(0.29)', transformOrigin: 'top left' }}>
        <ResumeRenderer content={SAMPLE_CONTENT as ContentJson} schema={schema} />
      </Box>
    </Box>
  );
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentTemplateId, setCurrentTemplateId] = useState<string>(() => {
    try { return window.localStorage.getItem(TEMPLATE_ID_KEY) || ''; } catch { return ''; }
  });
  const [preview, setPreview] = useState<Template | null>(null);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ items: Template[] }>('/templates');
      setTemplates(data.items || []);
    } catch (err) {
      setError(getErrorMessage(err, '模板列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const useTemplate = async (template: Template) => {
    setApplying(true);
    setNotice('');
    try {
      const currentResumeId = (() => {
        try { return window.localStorage.getItem(CURRENT_RESUME_KEY) || ''; } catch { return ''; }
      })();
      try { window.localStorage.setItem(TEMPLATE_ID_KEY, template.id); } catch { /* 忽略 */ }
      setCurrentTemplateId(template.id);

      if (currentResumeId) {
        await apiFetch(`/resumes/${currentResumeId}`, {
          method: 'PUT',
          body: JSON.stringify({ templateId: template.id }),
        });
        show('模板已切换，简历内容保持不变', 'success');
        navigate(`/resumes/${currentResumeId}/edit`);
      } else {
        const data = await apiFetch<{ resume: ResumeDetail }>('/resumes', {
          method: 'POST',
          body: JSON.stringify({ templateId: template.id, title: '我的简历' }),
        });
        try { window.localStorage.setItem(CURRENT_RESUME_KEY, data.resume.id); } catch { /* 忽略 */ }
        show('已用该模板创建简历', 'success');
        navigate(`/resumes/${data.resume.id}/edit`);
      }
    } catch (err) {
      setNotice(getErrorMessage(err, '应用模板失败，请稍后重试'));
      show(getErrorMessage(err, '应用模板失败'), 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Box className="ra-page">
      <PageHeader
        title="模板库"
        description="3 套内置模板，切换只改版式与配色，已填写的简历内容不会丢失。"
        actions={<Button variant="outlined" onClick={() => navigate('/resumes')}>查看我的简历</Button>}
      />

      {notice && <Alert severity="warning" sx={{ mb: 2 }}>{notice}</Alert>}

      {loading ? <LoadingState message="正在加载模板…" />
        : error ? <ErrorState message={error} onRetry={() => { void load(); }} />
          : templates.length === 0 ? (
            <EmptyState title="暂无可用模板" description="请重启服务以初始化内置模板。" />
          ) : (
            <Grid container spacing={2}>
              {templates.map((template) => {
                const isCurrent = currentTemplateId === template.id;
                return (
                  <Grid item xs={12} sm={6} md={4} key={template.id}>
                    <Card
                      variant="outlined"
                      sx={{
                        height: '100%', display: 'flex', flexDirection: 'column',
                        borderColor: isCurrent ? 'primary.main' : undefined,
                        borderWidth: isCurrent ? 2 : 1,
                        transition: 'box-shadow .15s ease',
                        '&:hover': { boxShadow: '0 8px 24px rgba(15,23,42,.12)' },
                      }}
                    >
                      <CardContent sx={{ pb: 1 }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
                          <Typography variant="h6" fontWeight={800} sx={{ flex: 1 }}>
                            {template.name}
                          </Typography>
                          {isCurrent && (
                            <Chip icon={<CheckIcon />} label="当前使用" color="primary" size="small" />
                          )}
                        </Stack>
                        <TemplateThumb schema={template.schema_json} />
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                          {template.schema_json?.description || '结构化简历模板'}
                        </Typography>
                        <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                          {(template.schema_json?.tags || []).map((tag) => (
                            <Chip key={tag} label={tag} size="small" variant="outlined" />
                          ))}
                        </Stack>
                      </CardContent>
                      <CardActions sx={{ mt: 'auto', px: 2, pb: 2, gap: 1, flexWrap: 'wrap' }}>
                        <Button
                          variant="contained"
                          disabled={applying}
                          onClick={() => { void useTemplate(template); }}
                          sx={{ minHeight: 44 }}
                        >
                          {applying ? '应用中…' : '使用此模板'}
                        </Button>
                        <Button
                          variant="outlined"
                          startIcon={<PreviewIcon />}
                          onClick={() => setPreview(template)}
                          sx={{ minHeight: 44 }}
                        >
                          预览大图
                        </Button>
                      </CardActions>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}

      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} fullWidth maxWidth="md">
        <DialogTitle>
          模板预览 · {preview?.name}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            （下方为示例数据，不含任何真实个人信息）
          </Typography>
        </DialogTitle>
        <DialogContent dividers sx={{ background: '#F5F7FA', maxHeight: '70vh', p: { xs: 1, md: 2 } }}>
          {preview && (
            <Box className="ra-scroll-x" sx={{ width: '100%' }}>
              <Box sx={{ width: 794, transform: 'scale(0.72)', transformOrigin: 'top left', height: 830 }}>
                <ResumeRenderer content={SAMPLE_CONTENT as ContentJson} schema={preview.schema_json} />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap' }}>
          <Button onClick={() => setPreview(null)} sx={{ minHeight: 44 }}>关闭</Button>
          {preview && (
            <Button
              variant="contained"
              disabled={applying}
              onClick={() => { const target = preview; setPreview(null); void useTemplate(target); }}
              sx={{ minHeight: 44 }}
            >
              使用此模板
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
