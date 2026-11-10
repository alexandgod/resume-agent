/**
 * P7 扫码公开只读页：不套 Layout、不读 authStore、不调 apiFetch，只用 publicFetch。
 * 无导航栏、无登录入口、无任何编辑入口；失效链接统一提示页，不泄露任何内容。
 * 邮箱与手机号在服务端发布快照时已被剔除。
 */
import { useEffect, useState } from 'react';
import { Box, Skeleton, Typography } from '@mui/material';
import { LockOutlined as LockIcon } from '@mui/icons-material';
import { useParams } from 'react-router-dom';
import { publicFetch, ApiClientError } from '../api/client';
import ResumeRenderer from '../components/ResumeRenderer';
import type { PublicSnapshot } from '../types';

type ViewState = 'loading' | 'ready' | 'invalid';

export default function PublicResumePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [state, setState] = useState<ViewState>('loading');
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setState('loading');
      try {
        const data = await publicFetch<PublicSnapshot>(`/share/${encodeURIComponent(token)}`);
        if (!alive) return;
        setSnapshot(data);
        setState('ready');
      } catch (error) {
        if (!alive) return;
        if (error instanceof ApiClientError && error.code === 404) {
          setMessage('链接已失效或已被作者关闭');
        } else if (error instanceof ApiClientError && error.code === 422) {
          setMessage('链接格式不正确');
        } else {
          setMessage('暂时无法查看该简历，请稍后重试');
        }
        setState('invalid');
      }
    };
    void load();
    return () => { alive = false; };
  }, [token]);

  if (state === 'loading') {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', px: { xs: 1.5, sm: 3 }, py: 4, width: '100%' }}>
        <Skeleton variant="text" width="55%" height={38} />
        <Skeleton variant="text" width="35%" height={20} sx={{ mb: 3 }} />
        <Skeleton variant="rectangular" height={620} sx={{ borderRadius: 1 }} />
      </Box>
    );
  }

  if (state === 'invalid' || !snapshot) {
    return (
      <Box
        sx={{
          minHeight: '70vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2,
        }}
      >
        <LockIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
        <Typography variant="h5" fontWeight={800} sx={{ mt: 2 }}>{message || '链接已失效'}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          该分享可能已被作者关闭，或链接不完整。请联系简历作者获取最新链接。
        </Typography>
      </Box>
    );
  }

  const published = new Date(snapshot.publishedAt);
  const publishedText = Number.isNaN(published.getTime())
    ? snapshot.publishedAt
    : published.toLocaleString('zh-CN', { hour12: false });

  return (
    <Box sx={{ width: '100%', maxWidth: 900, mx: 'auto', px: { xs: 0, sm: 2 }, py: { xs: 2, sm: 4 } }}>
      <Box sx={{ px: { xs: 2, sm: 0 }, mb: 2 }}>
        <Typography variant="h5" fontWeight={800} sx={{ wordBreak: 'break-all' }}>
          {snapshot.title || '简历'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          发布于 {publishedText} · 只读快照
        </Typography>
      </Box>

      <Box className="ra-scroll-x" sx={{ width: '100%' }}>
        {snapshot.template && (
          <ResumeRenderer content={snapshot.content} schema={snapshot.template} />
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 3, mb: 2 }}>
        由 简历 Agent 生成 · 本页为只读快照，不含账号与联系方式
      </Typography>
    </Box>
  );
}
