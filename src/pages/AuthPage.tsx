/**
 * P1 登录 / 注册页：Tab 切换、密码显隐、字段校验、锁定倒计时、成功回跳。
 * 公开页面，不套 Layout；登录成功后取 redirect 参数回跳，无则 /workspace。
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiClientError } from '../api/client';
import { FormField, PasswordField, getErrorMessage, useToast } from '../components/shell';
import { useAuth } from '../store/authStore';
import type { User } from '../types';

interface AuthResult {
  user: User;
  token: string;
  expiresIn: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[\w\u4e00-\u9fa5.-]{2,30}$/u;

export default function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/workspace';
  const { login, status } = useAuth();
  const { show } = useToast();

  const [tab, setTab] = useState(0);
  const [account, setAccount] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);

  // 已登录用户直接回跳，避免停留在登录页。
  useEffect(() => {
    if (status === 'authed') navigate(redirect, { replace: true });
  }, [status, redirect, navigate]);

  useEffect(() => {
    if (!lockedUntil) return undefined;
    const tick = () => {
      const ms = Date.parse(lockedUntil) - Date.now();
      const next = Math.max(0, Math.ceil(ms / 1000));
      setRemaining(next);
      if (next <= 0) {
        setLockedUntil(null);
        setErrorText('');
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const locked = Boolean(lockedUntil) && remaining > 0;

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (tab === 0) {
      if (account && account.trim().length < 2) errors.account = '请输入邮箱或用户名';
      if (password && password.length < 6) errors.password = '请输入密码';
    } else {
      if (email && !EMAIL_RE.test(email.trim())) errors.email = '邮箱格式不正确';
      if (username && !USERNAME_RE.test(username.trim())) errors.username = '用户名需为 2~30 位中英文或数字';
      if (password && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
        errors.password = '密码需至少 8 位且包含字母与数字';
      }
      if (confirmPassword && confirmPassword !== password) errors.confirmPassword = '两次输入的密码不一致';
    }
    return errors;
  }, [tab, account, email, username, password, confirmPassword]);

  const canSubmit = !submitting && !locked && (
    tab === 0
      ? account.trim().length > 0 && password.length > 0
      : EMAIL_RE.test(email.trim())
        && USERNAME_RE.test(username.trim())
        && password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
        && confirmPassword === password
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorText('');
    const body = tab === 0
      ? { account: account.trim(), password, rememberMe }
      : { email: email.trim().toLowerCase(), username: username.trim(), password, confirmPassword };
    const path = tab === 0 ? '/auth/login' : '/auth/register';
    try {
      const data = await apiFetch<AuthResult>(path, { method: 'POST', body: JSON.stringify(body) });
      login(data.user, data.token);
      show(tab === 0 ? '欢迎回来' : '注册成功，已为你创建账号', 'success');
      navigate(redirect, { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 429 && error.data.lockedUntil) {
        setLockedUntil(String(error.data.lockedUntil));
      }
      setErrorText(getErrorMessage(error, '操作失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh', width: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', p: { xs: 2, md: 4 },
        background: 'linear-gradient(135deg,#EFF6FF 0%,#F5F7FA 55%,#E8EEF6 100%)',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 980, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* 左侧产品价值文案（移动端自动隐藏） */}
        <Box sx={{ flex: '1 1 320px', display: { xs: 'none', md: 'block' } }}>
          <Typography variant="h3" fontWeight={800} sx={{ color: '#1E3A5F', lineHeight: 1.3 }}>
            零散资料，<br />一键变成好简历
          </Typography>
          <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary', lineHeight: 2 }}>
            上传文本 / PDF / Word 资料 → 挑选模板 → 一键生成结构化简历 → 微调保存 → 生成二维码，
            他人扫码即可免登录查看只读简历。
          </Typography>
          <Stack spacing={1} sx={{ mt: 3 }}>
            {['私有保存，所有数据只属于你', '无大模型密钥也能规则化生成', '分享快照自动隐藏邮箱与手机号'].map((text) => (
              <Typography key={text} variant="body2" color="text.secondary">✓ {text}</Typography>
            ))}
          </Stack>
        </Box>

        {/* 右侧表单卡片 */}
        <Card sx={{ flex: '1 1 360px', maxWidth: 440, width: '100%', borderRadius: 3, boxShadow: '0 12px 40px rgba(15,23,42,.10)' }}>
          <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
            <Typography variant="h5" fontWeight={800} sx={{ mb: 0.5 }}>简历 Agent</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              登录后即可开始整理你的履历资料
            </Typography>
            <Tabs
              value={tab}
              onChange={(_, value: number) => { setTab(value); setErrorText(''); setLockedUntil(null); }}
              variant="fullWidth"
              sx={{ mb: 1, minHeight: 44 }}
            >
              <Tab label="登录" sx={{ minHeight: 44 }} />
              <Tab label="注册" sx={{ minHeight: 44 }} />
            </Tabs>

            {errorText && (
              <Alert severity={locked ? 'warning' : 'error'} sx={{ mt: 1, mb: 1 }}>
                {locked ? `${errorText}（剩余 ${remaining} 秒）` : errorText}
              </Alert>
            )}

            <Box component="form" onSubmit={handleSubmit} noValidate>
              {tab === 0 ? (
                <>
                  <FormField
                    label="邮箱或用户名"
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    errorText={fieldErrors.account}
                    autoComplete="username"
                  />
                  <PasswordField
                    label="密码"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    errorText={fieldErrors.password}
                    autoComplete="current-password"
                  />
                  <FormControlLabel
                    control={<Checkbox checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />}
                    label="记住我（7 天内保持登录）"
                    sx={{ mt: 0.5 }}
                  />
                </>
              ) : (
                <>
                  <FormField
                    label="邮箱"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    errorText={fieldErrors.email}
                    autoComplete="email"
                  />
                  <FormField
                    label="用户名"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    errorText={fieldErrors.username}
                    autoComplete="nickname"
                  />
                  <PasswordField
                    label="密码（至少 8 位，含字母与数字）"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    errorText={fieldErrors.password}
                    autoComplete="new-password"
                  />
                  <PasswordField
                    label="确认密码"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    errorText={fieldErrors.confirmPassword}
                    autoComplete="new-password"
                  />
                </>
              )}

              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={!canSubmit}
                sx={{ mt: 1.5, minHeight: 46 }}
                startIcon={submitting ? undefined : undefined}
              >
                {submitting ? '处理中…' : tab === 0 ? '登录' : '注册并登录'}
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, textAlign: 'center' }}>
                演示环境无需任何大模型密钥即可完成「生成 → 分享 → 扫码查看」全流程
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
