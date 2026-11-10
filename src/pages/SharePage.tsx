/**
 * P6 分享与二维码页：开关、链接复制、二维码展示与 PNG 下载、风险提示、
 * 关闭二次确认、重新发布（沿用原 token 更新快照）、关闭态锁形占位。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  Lock as LockIcon,
  ContentCopy as CopyIcon,
  Refresh as RepublishIcon,
  QrCode2 as QrIcon,
  OpenInNew as OpenIcon,
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import {
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageHeader,
  getErrorMessage,
  useToast,
} from '../components/shell';
import type { QrView, ResumeDetail, ShareView } from '../types';

const EMPTY_SHARE: ShareView = {
  enabled: false, url: '', token: '', viewCount: 0, createdAt: '', revokedAt: '',
};

export default function SharePage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { show } = useToast();
  const [resumeTitle, setResumeTitle] = useState('');
  const [share, setShare] = useState<ShareView>(EMPTY_SHARE);
  const [qr, setQr] = useState<QrView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadQr = useCallback(async () => {
    try {
      const data = await apiFetch<QrView>(`/resumes/${id}/share/qrcode?size=320`);
      setQr(data);
    } catch {
      setQr(null);
    }
  }, [id]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [shareData, resumeData] = await Promise.all([
        apiFetch<{ share: ShareView }>(`/resumes/${id}/share`),
        apiFetch<{ resume: ResumeDetail }>(`/resumes/${id}`),
      ]);
      setShare(shareData.share || EMPTY_SHARE);
      setResumeTitle(resumeData.resume?.title || '我的简历');
      if (shareData.share?.enabled) {
        await loadQr();
      } else {
        setQr(null);
      }
    } catch (err) {
      setError(getErrorMessage(err, '分享状态加载失败'));
    } finally {
      setLoading(false);
    }
  }, [id, loadQr]);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (enabled: boolean) => {
    if (enabled) {
      setBusy(true);
      try {
        const data = await apiFetch<{ share: ShareView }>(`/resumes/${id}/share`, { method: 'POST' });
        setShare(data.share);
        await loadQr();
        show('分享已开启，二维码已生成', 'success');
      } catch (err) {
        show(getErrorMessage(err, '开启分享失败'), 'error');
      } finally {
        setBusy(false);
      }
    } else {
      setConfirmOpen(true);
    }
  };

  const confirmDisable = async () => {
    setBusy(true);
    try {
      const data = await apiFetch<{ share: ShareView }>(`/resumes/${id}/share`, { method: 'DELETE' });
      setShare(data.share || EMPTY_SHARE);
      setQr(null);
      setConfirmOpen(false);
      show('分享已关闭，旧链接立即失效', 'success');
    } catch (err) {
      show(getErrorMessage(err, '关闭分享失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRepublish = async () => {
    setBusy(true);
    try {
      const data = await apiFetch<{ share: ShareView }>(`/resumes/${id}/share/republish`, { method: 'POST' });
      setShare(data.share);
      show('已用最新简历内容重新发布快照（链接不变）', 'success');
    } catch (err) {
      show(getErrorMessage(err, '重新发布失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!share.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
      show('链接已复制', 'success');
    } catch {
      show('复制失败，请手动选中链接复制', 'warning');
    }
  };

  if (loading) return <LoadingState message="正在加载分享状态…" />;
  if (error) return <ErrorState message={error} onRetry={() => { void load(); }} />;

  return (
    <Box className="ra-page">
      <PageHeader
        title="分享简历"
        description={`「${resumeTitle}」· 默认未分享；开启后生成只读快照链接与二维码。`}
        actions={<Button variant="outlined" onClick={() => navigate(`/resumes/${id}/edit`)} sx={{ minHeight: 44 }}>返回编辑</Button>}
      />

      <Alert severity="warning" sx={{ mb: 2 }}>
        风险提示：任何拿到链接的人都可查看这份简历，无需登录。快照已自动隐藏邮箱与手机号；
        编辑简历不会自动改变已分享内容，需点击「重新发布」。关闭分享后旧链接立即失效，重新开启会生成全新链接。
      </Alert>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="h6" fontWeight={800} sx={{ flex: 1 }}>分享设置</Typography>
                <Chip
                  label={share.enabled ? '分享中' : '未分享'}
                  color={share.enabled ? 'success' : 'default'}
                  size="small"
                />
              </Stack>

              <FormControlLabel
                control={<Switch checked={share.enabled} disabled={busy} onChange={(event) => { void handleToggle(event.target.checked); }} />}
                label={share.enabled ? '已开启分享（点击关闭需二次确认）' : '开启分享'}
                sx={{ mb: 2, minHeight: 44 }}
              />

              <TextField
                fullWidth size="small" label="只读链接"
                value={share.enabled ? share.url : ''}
                placeholder="开启分享后自动生成"
                InputProps={{ readOnly: true }}
                inputProps={{ 'aria-label': '简历只读链接' }}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
                <Button variant="outlined" startIcon={<CopyIcon />} disabled={!share.enabled} onClick={() => { void copyLink(); }} sx={{ minHeight: 44 }}>
                  复制链接
                </Button>
                <Button
                  variant="text" startIcon={<OpenIcon />} disabled={!share.enabled}
                  onClick={() => window.open(share.url, '_blank', 'noopener,noreferrer')}
                  sx={{ minHeight: 44 }}
                >
                  新窗口预览
                </Button>
              </Stack>

              <Stack direction="row" spacing={1} sx={{ mt: 2.5, flexWrap: 'wrap', gap: 1 }}>
                <Button variant="outlined" startIcon={<RepublishIcon />} disabled={!share.enabled || busy} onClick={() => { void handleRepublish(); }} sx={{ minHeight: 44 }}>
                  重新发布快照
                </Button>
                <Button color="error" variant="outlined" disabled={!share.enabled || busy} onClick={() => setConfirmOpen(true)} sx={{ minHeight: 44 }}>
                  关闭分享
                </Button>
              </Stack>

              <Stack direction="row" spacing={1} sx={{ mt: 2.5, flexWrap: 'wrap', gap: 1 }}>
                <Chip label={`访问次数：${share.viewCount}`} size="small" variant="outlined" />
                {share.createdAt && <Chip label={`创建：${new Date(share.createdAt).toLocaleString('zh-CN', { hour12: false })}`} size="small" variant="outlined" />}
                {!share.enabled && share.revokedAt && <Chip label="已撤销" color="warning" size="small" variant="outlined" />}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>扫码查看</Typography>
              {share.enabled && qr ? (
                <>
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <img
                      src={qr.dataUrl}
                      alt="简历分享二维码"
                      style={{ width: 240, maxWidth: '100%', height: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                    微信扫一扫或系统相机均可识别；手机与电脑需在同一局域网，且 PUBLIC_BASE_URL 已设为本机 IP。
                  </Typography>
                  <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <a
                      href={qr.dataUrl}
                      download="resume-qr.png"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minHeight: 44, padding: '0 18px', borderRadius: 8, textDecoration: 'none',
                        border: '1px solid #2563EB', color: '#2563EB', fontWeight: 600, fontSize: 14,
                      }}
                    >
                      下载 PNG
                    </a>
                  </Box>
                </>
              ) : (
                <Box sx={{ py: 5 }}>
                  <LockIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
                  <Typography variant="body1" sx={{ mt: 1.5 }}>分享未开启</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    开启分享后，这里会展示可下载、可扫码的二维码。
                  </Typography>
                  <QrIcon sx={{ fontSize: 28, color: 'text.disabled', mt: 2 }} />
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <ConfirmDialog
        open={confirmOpen}
        title="关闭分享"
        message="关闭后当前链接与二维码立即失效，任何人再通过旧链接访问都会看到「链接已失效」。重新开启将生成全新链接。确认关闭？"
        confirmText="确认关闭"
        danger
        loading={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { void confirmDisable(); }}
      />
    </Box>
  );
}
