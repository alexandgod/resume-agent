/**
 * P2 资料管理页：拖拽/多选上传、文本粘贴、资料卡片 CRUD、解析状态、重新解析、
 * 进度与超限提示、删除二次确认。移动端上下堆叠，按钮可点区域 ≥44×44px。
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
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
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  Description as DescriptionIcon,
  Image as ImageIcon,
  InsertDriveFile as FileIcon,
  ContentPaste as PasteIcon,
} from '@mui/icons-material';
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
import type { Material, ParseStatus } from '../types';

const ALLOWED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx', '.doc', '.png', '.jpg', '.jpeg', '.webp'];
const MAX_FILE_SIZE_MB = 10;

const STATUS_MAP: Record<ParseStatus, { label: string; tone: 'success' | 'warning' | 'error' | 'info' | 'default' }> = {
  success: { label: '解析成功', tone: 'success' },
  failed: { label: '解析失败', tone: 'error' },
  skipped: { label: '仅存档', tone: 'info' },
  pending: { label: '待解析', tone: 'warning' },
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false });
}

function materialIcon(type: string) {
  if (type === 'image') return <ImageIcon color="action" />;
  if (type === 'pdf' || type === 'docx' || type === 'doc') return <DescriptionIcon color="action" />;
  return <FileIcon color="action" />;
}

export default function MaterialsPage() {
  const { show } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [failedNotes, setFailedNotes] = useState<string[]>([]);
  const [editTarget, setEditTarget] = useState<Material | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editRaw, setEditRaw] = useState('');
  const [editParsed, setEditParsed] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch<{ items: Material[]; total: number }>('/materials');
      setItems(data.items || []);
    } catch (error) {
      setLoadError(getErrorMessage(error, '资料列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const invalid = files.find((file) => {
      const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
      return !ALLOWED_EXTENSIONS.includes(ext) || file.size > MAX_FILE_SIZE_MB * 1024 * 1024;
    });
    if (invalid) {
      show(`「${invalid.name}」类型不支持或超过 ${MAX_FILE_SIZE_MB}MB，请检查后重试`, 'error');
      return;
    }
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    setUploading(true);
    setFailedNotes([]);
    try {
      const result = await apiFetch<{
        items: Material[];
        failed: { fileName: string; reason: string }[];
      }>('/materials/upload', { method: 'POST', body: form });
      const notes = (result.failed || []).map((item) => `${item.fileName}：${item.reason}`);
      setFailedNotes(notes);
      show(`已上传 ${result.items?.length || 0} 份资料${notes.length ? `，${notes.length} 份需手动补录` : ''}`, notes.length ? 'warning' : 'success');
      await load();
    } catch (error) {
      show(getErrorMessage(error, '上传失败，请稍后重试'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void uploadFiles(files);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files || []));
  };

  const handlePaste = async () => {
    if (!pasteText.trim()) {
      show('请先粘贴或输入资料文本', 'warning');
      return;
    }
    setSavingText(true);
    try {
      await apiFetch('/materials/text', {
        method: 'POST',
        body: JSON.stringify({ rawText: pasteText, title: pasteTitle.trim() || undefined }),
      });
      setPasteText('');
      setPasteTitle('');
      show('文本资料已保存', 'success');
      await load();
    } catch (error) {
      show(getErrorMessage(error, '保存失败'), 'error');
    } finally {
      setSavingText(false);
    }
  };

  const openEdit = (material: Material) => {
    setEditTarget(material);
    setEditTitle(material.file_name || '');
    setEditRaw(material.raw_text || '');
    setEditParsed(material.parsed_text || '');
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    if (!editTitle.trim()) {
      show('资料名称不能为空', 'warning');
      return;
    }
    setSavingEdit(true);
    try {
      await apiFetch(`/materials/${editTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: editTitle, rawText: editRaw, parsedText: editParsed }),
      });
      setEditTarget(null);
      show('资料已更新', 'success');
      await load();
    } catch (error) {
      show(getErrorMessage(error, '保存失败'), 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/materials/${deleteTarget.id}`, { method: 'DELETE' });
      show('资料已删除，已生成简历不受影响', 'success');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      show(getErrorMessage(error, '删除失败'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleReparse = async (material: Material) => {
    try {
      await apiFetch(`/materials/${material.id}/reparse`, { method: 'POST' });
      show('已重新解析', 'success');
      await load();
    } catch (error) {
      show(getErrorMessage(error, '重新解析失败，可手动补录'), 'error');
    }
  };

  return (
    <Box className="ra-page">
      <PageHeader
        title="资料库"
        description={`汇总零散履历资料，供一键生成使用。单文件 ≤${MAX_FILE_SIZE_MB}MB，单用户 ≤50 份；当前 ${items.length} 份。`}
        actions={
          <Button variant="contained" startIcon={<CloudUploadIcon />} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? '上传中…' : '上传资料'}
          </Button>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS.join(',')}
        onChange={handleInputChange}
        style={{ display: 'none' }}
        aria-label="选择要上传的资料文件"
      />

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={7}>
          <div
            className={`ra-dropzone${dragActive ? ' ra-dropzone--active' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click(); }}
            style={{ padding: '22px 16px', textAlign: 'center', cursor: 'pointer', minHeight: 128 }}
          >
            <CloudUploadIcon sx={{ fontSize: 40, color: 'primary.main' }} />
            <Typography variant="body1" fontWeight={700} sx={{ mt: 1 }}>拖拽文件到这里，或点击选择</Typography>
            <Typography variant="caption" color="text.secondary">
              支持 TXT / MD / PDF / DOCX / DOC / PNG / JPG / WEBP，可多选批量上传
            </Typography>
            {uploading && <LinearProgress sx={{ mt: 2 }} />}
          </div>
        </Grid>
        <Grid item xs={12} md={5}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <PasteIcon color="primary" />
                <Typography fontWeight={700}>直接粘贴文本</Typography>
              </Stack>
              <TextField
                fullWidth
                size="small"
                label="资料名称（可选）"
                value={pasteTitle}
                onChange={(event) => setPasteTitle(event.target.value)}
                sx={{ mb: 1 }}
                inputProps={{ 'aria-label': '资料名称' }}
              />
              <TextField
                fullWidth
                multiline
                minRows={3}
                maxRows={6}
                placeholder="粘贴简历、项目记录、证书信息等文本…"
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                inputProps={{ 'aria-label': '资料文本内容' }}
              />
              <Button
                variant="outlined"
                fullWidth
                disabled={savingText || !pasteText.trim()}
                onClick={() => { void handlePaste(); }}
                sx={{ mt: 1, minHeight: 44 }}
              >
                {savingText ? '保存中…' : '保存为资料'}
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {failedNotes.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {failedNotes.map((note) => <div key={note}>{note}</div>)}
          <Typography variant="caption">解析失败不影响闭环，可在资料卡片中手动补录文字后参与生成。</Typography>
        </Alert>
      )}

      {loading ? <LoadingState message="正在加载资料…" />
        : loadError ? <ErrorState message={loadError} onRetry={() => { void load(); }} />
          : items.length === 0 ? (
            <EmptyState
              title="还没有资料，上传第一份吧"
              description="支持拖拽上传、多选文件，或直接粘贴一段履历文本。"
              action={<Button variant="contained" onClick={() => fileInputRef.current?.click()}>选择文件</Button>}
            />
          ) : (
            <Grid container spacing={2}>
              {items.map((material) => {
                const status = STATUS_MAP[material.parse_status] || STATUS_MAP.pending;
                return (
                  <Grid item xs={12} sm={6} lg={4} key={material.id}>
                    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                      <CardContent sx={{ flex: 1, pb: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {materialIcon(material.type)}
                          <Typography fontWeight={700} noWrap sx={{ flex: 1 }} title={material.file_name}>
                            {material.file_name || '未命名资料'}
                          </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
                          <Chip label={status.label} color={status.tone} size="small" />
                          <Chip label={material.type.toUpperCase()} size="small" variant="outlined" />
                          <Chip label={formatSize(material.size)} size="small" variant="outlined" />
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                          {formatTime(material.created_at)}
                        </Typography>
                        {material.parse_message && (
                          <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                            {material.parse_message}
                          </Typography>
                        )}
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                        >
                          {material.parsed_text || material.raw_text || '暂无可预览文本'}
                        </Typography>
                      </CardContent>
                      <CardActions sx={{ px: 1.5, pb: 1.5, gap: 0.5, flexWrap: 'wrap' }}>
                        <Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(material)}>编辑</Button>
                        <Tooltip title="重新解析">
                          <IconButton aria-label="重新解析" onClick={() => { void handleReparse(material); }}>
                            <RefreshIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除资料">
                          <IconButton aria-label="删除资料" color="error" onClick={() => setDeleteTarget(material)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </CardActions>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}

      {/* 编辑弹窗（抽屉式侧滑面板的等价实现） */}
      <Dialog open={Boolean(editTarget)} onClose={() => setEditTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>编辑资料</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth margin="normal" label="资料名称" value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            inputProps={{ 'aria-label': '资料名称' }}
          />
          <TextField
            fullWidth margin="normal" label="原始文本" multiline minRows={3} value={editRaw}
            onChange={(event) => setEditRaw(event.target.value)}
            inputProps={{ 'aria-label': '原始文本' }}
          />
          <TextField
            fullWidth margin="normal" label="解析文本（参与生成，可手动补录）" multiline minRows={4}
            value={editParsed} onChange={(event) => setEditParsed(event.target.value)}
            helperText="PDF/DOCX 解析失败时，把内容粘贴到这里即可参与生成。"
            inputProps={{ 'aria-label': '解析文本' }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditTarget(null)} sx={{ minHeight: 44 }}>取消</Button>
          <Button variant="contained" disabled={savingEdit} onClick={() => { void saveEdit(); }} sx={{ minHeight: 44 }}>
            {savingEdit ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除资料"
        message={`确认删除「${deleteTarget?.file_name || ''}」？已生成简历中的内容不会受影响。`}
        confirmText="确认删除"
        danger
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => { void confirmDelete(); }}
      />
    </Box>
  );
}
