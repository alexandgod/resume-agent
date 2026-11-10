/**
 * P5 我的简历列表：搜索 / 状态筛选、新建 / 重命名 / 删除 / 设为当前、分享状态标识。
 * 列表按更新时间倒序；删除统一二次确认。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Share as ShareIcon,
  ContentCopy as CopyIcon,
  DriveFileRenameOutline as RenameIcon,
  BookmarkAdded as CurrentIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  getErrorMessage,
  useToast,
} from '../components/shell';
import type { ResumeDetail, ResumeListItem, Template } from '../types';

const CURRENT_RESUME_KEY = 'ra_current_resume_id';
const TEMPLATE_ID_KEY = 'ra_template_id';

type FilterValue = 'all' | 'draft' | 'final' | 'shared';

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false });
}

export default function ResumesPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [items, setItems] = useState<ResumeListItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ResumeListItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ResumeListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [currentId, setCurrentId] = useState<string>(() => {
    try { return window.localStorage.getItem(CURRENT_RESUME_KEY) || ''; } catch { return ''; }
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [resumeData, templateData] = await Promise.all([
        apiFetch<{ items: ResumeListItem[] }>('/resumes'),
        apiFetch<{ items: Template[] }>('/templates'),
      ]);
      setItems(resumeData.items || []);
      setTemplates(templateData.items || []);
    } catch (err) {
      setError(getErrorMessage(err, '简历列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => items.filter((item) => {
    const matchesQuery = item.title.toLowerCase().includes(query.trim().toLowerCase());
    if (!matchesQuery) return false;
    if (filter === 'shared') return item.shareStatus === '分享中';
    if (filter === 'all') return true;
    return item.status === filter;
  }), [items, query, filter]);

  const persistCurrent = (resumeId: string, templateId: string) => {
    try {
      window.localStorage.setItem(CURRENT_RESUME_KEY, resumeId);
      if (templateId) window.localStorage.setItem(TEMPLATE_ID_KEY, templateId);
    } catch { /* 忽略存储异常 */ }
    setCurrentId(resumeId);
  };

  const handleCreate = async () => {
    if (templates.length === 0) {
      show('模板尚未就绪，请稍后重试', 'warning');
      return;
    }
    setCreating(true);
    try {
      const data = await apiFetch<{ resume: ResumeDetail }>('/resumes', {
        method: 'POST',
        body: JSON.stringify({ templateId: templates[0].id, title: '我的简历' }),
      });
      persistCurrent(data.resume.id, data.resume.template_id);
      show('已新建简历', 'success');
      navigate(`/resumes/${data.resume.id}/edit`);
    } catch (err) {
      show(getErrorMessage(err, '新建失败'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    if (!renameValue.trim()) {
      show('标题不能为空', 'warning');
      return;
    }
    setRenaming(true);
    try {
      await apiFetch(`/resumes/${renameTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: renameValue.trim() }),
      });
      show('已重命名', 'success');
      setRenameTarget(null);
      await load();
    } catch (err) {
      show(getErrorMessage(err, '重命名失败'), 'error');
    } finally {
      setRenaming(false);
    }
  };

  const handleCopy = async (item: ResumeListItem) => {
    try {
      const data = await apiFetch<{ resume: ResumeDetail }>(`/resumes/${item.id}/copy`, {
        method: 'POST',
        body: JSON.stringify({ title: `${item.title}（副本）` }),
      });
      show('已复制为新版本', 'success');
      await load();
      navigate(`/resumes/${data.resume.id}/edit`);
    } catch (err) {
      show(getErrorMessage(err, '复制失败'), 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/resumes/${deleteTarget.id}`, { method: 'DELETE' });
      show('简历已删除，相关分享链接已失效', 'success');
      if (currentId === deleteTarget.id) {
        try { window.localStorage.removeItem(CURRENT_RESUME_KEY); } catch { /* 忽略 */ }
        setCurrentId('');
      }
      setDeleteTarget(null);
      await load();
    } catch (err) {
      show(getErrorMessage(err, '删除失败'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box className="ra-page">
      <PageHeader
        title="我的简历"
        description={`共 ${items.length} 份简历，按最近更新排序；支持多版本并存、草稿 / 定稿状态与分享状态。`}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} disabled={creating} onClick={() => { void handleCreate(); }} sx={{ minHeight: 44 }}>
            {creating ? '创建中…' : '新建简历'}
          </Button>
        }
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          size="small" label="搜索简历标题" value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ flex: '1 1 240px' }}
          inputProps={{ 'aria-label': '搜索简历标题' }}
        />
        <TextField
          select size="small" label="状态筛选" value={filter}
          onChange={(event) => setFilter(event.target.value as FilterValue)}
          sx={{ flex: '0 1 180px', minWidth: 150 }}
          inputProps={{ 'aria-label': '状态筛选' }}
        >
          <MenuItem value="all">全部</MenuItem>
          <MenuItem value="draft">草稿</MenuItem>
          <MenuItem value="final">已定稿</MenuItem>
          <MenuItem value="shared">分享中</MenuItem>
        </TextField>
      </Stack>

      {loading ? <LoadingState message="正在加载简历…" />
        : error ? <ErrorState message={error} onRetry={() => { void load(); }} />
          : filtered.length === 0 ? (
            items.length === 0 ? (
              <EmptyState
                title="还没有简历，用资料生成第一份吧"
                description="先到资料库上传或粘贴履历资料，再新建简历并一键生成。"
                action={
                  <>
                    <Button variant="contained" onClick={() => { void handleCreate(); }}>新建简历</Button>
                    <Button variant="outlined" onClick={() => navigate('/materials')}>去资料库</Button>
                  </>
                }
              />
            ) : (
              <EmptyState title="没有匹配的简历" description="试试调整搜索词或状态筛选。" />
            )
          ) : (
            <Grid container spacing={2}>
              {filtered.map((item) => (
                <Grid item xs={12} sm={6} lg={4} key={item.id}>
                  <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardContent sx={{ flex: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        <Typography variant="h6" fontWeight={800} sx={{ flex: '1 1 140px', wordBreak: 'break-all' }}>
                          {item.title}
                        </Typography>
                        {currentId === item.id && <Chip label="当前" color="primary" size="small" icon={<CurrentIcon />} />}
                      </Stack>
                      <Stack direction="row" spacing={0.5} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
                        <Chip label={item.status === 'final' ? '已定稿' : '草稿'} size="small" color={item.status === 'final' ? 'success' : 'default'} variant="outlined" />
                        <Chip label={item.shareStatus} size="small" color={item.shareStatus === '分享中' ? 'success' : 'default'} variant="outlined" />
                        <Chip label={`模板：${item.templateCode}`} size="small" variant="outlined" />
                        <Chip label={item.generationMode === 'ai' ? `AI · ${item.configSource}` : item.generationMode === 'rule' ? '规则化' : '未生成'} size="small" variant="outlined" />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                        更新于 {formatTime(item.updatedAt)}
                      </Typography>
                    </CardContent>
                    <CardActions sx={{ px: 1.5, pb: 1.5, gap: 0.5, flexWrap: 'wrap' }}>
                      <Button size="small" startIcon={<EditIcon />} onClick={() => { persistCurrent(item.id, ''); navigate(`/resumes/${item.id}/edit`); }}>编辑</Button>
                      <Button size="small" startIcon={<ShareIcon />} onClick={() => navigate(`/resumes/${item.id}/share`)}>分享</Button>
                      <Button size="small" startIcon={<RenameIcon />} onClick={() => { setRenameTarget(item); setRenameValue(item.title); }}>重命名</Button>
                      <Button size="small" startIcon={<CopyIcon />} onClick={() => { void handleCopy(item); }}>复制</Button>
                      <Button size="small" startIcon={<CurrentIcon />} onClick={() => { persistCurrent(item.id, ''); show('已设为当前简历', 'success'); }}>设为当前</Button>
                      <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteTarget(item)}>删除</Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}

      {items.length > 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          提示：本期导出 PDF 使用浏览器「打印 / 另存为 PDF」兜底，在编辑页点击「打印 / 另存 PDF」即可。
        </Alert>
      )}

      <Dialog open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>重命名简历</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth margin="normal" label="新标题" value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            inputProps={{ 'aria-label': '简历新标题' }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRenameTarget(null)} sx={{ minHeight: 44 }}>取消</Button>
          <Button variant="contained" disabled={renaming} onClick={() => { void handleRename(); }} sx={{ minHeight: 44 }}>
            {renaming ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除简历"
        message={`确认删除「${deleteTarget?.title || ''}」？该简历的所有分享链接会立即失效，操作不可恢复。`}
        confirmText="确认删除"
        danger
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => { void handleDelete(); }}
      />
    </Box>
  );
}
