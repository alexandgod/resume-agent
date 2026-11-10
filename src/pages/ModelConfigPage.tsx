/**
 * P8「设置 → 模型配置」（架构 v1.1，前端路由 /settings/llm）。
 *
 * - 唯一数据接口：GET / PUT / DELETE /api/settings/llm 与 POST /api/settings/llm/test；
 *   生效来源由 GET 响应的 effectiveSource 提供（不再有独立 /status 接口）。
 * - 来源状态条、api_key 用 type="password" + 显隐切换 + 掩码回显（S7）、
 *   启用开关、测试连接（10s 返回耗时）、保存/删除二次确认、风险提示、表单校验禁用保存。
 * - 前端绝不传递或拼接除表单录入外的任何密钥；响应只含掩码与 configured 布尔值。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  SmartToy as AiIcon,
  Rule as RuleIcon,
  Cloud as EnvIcon,
  DeleteForever as DeleteIcon,
  Speed as TestIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { apiFetch } from '../api/client';
import {
  ConfirmDialog,
  FormField,
  LoadingState,
  PageHeader,
  PasswordField,
  getErrorMessage,
  useToast,
} from '../components/shell';
import type {
  ConfigSource,
  LlmDeleteResult,
  LlmSettings,
  LlmTestPayload,
  TestConnectionResult,
} from '../types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

/** 与服务端一致的接口地址校验（Q3）：HTTPS 或本机 http。 */
function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const protocol = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    return protocol === 'https:' || (protocol === 'http:' && isLocal);
  } catch {
    return false;
  }
}

function formatTime(iso: string): string {
  if (!iso) return '尚未测试';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false });
}

export default function ModelConfigPage() {
  const { show } = useToast();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [configured, setConfigured] = useState(false);
  const [configName, setConfigName] = useState('我的模型配置');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [apiKey, setApiKey] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [savedMask, setSavedMask] = useState('');
  const [savedTestedAt, setSavedTestedAt] = useState('');
  const [localTestedAt, setLocalTestedAt] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [pageError, setPageError] = useState('');

  /** 把 GET /api/settings/llm 的响应回填到表单与来源状态条。 */
  const applySettings = useCallback((data: LlmSettings) => {
    setSettings(data);
    const config = data.config;
    setConfigured(Boolean(data.configured && config));
    setConfigName(config?.config_name || '我的模型配置');
    setBaseUrl(config?.base_url || DEFAULT_BASE_URL);
    setModel(config?.model || DEFAULT_MODEL);
    setSavedMask(config?.api_key_mask || '');
    setIsEnabled(config ? Boolean(config.is_enabled) : true);
    setSavedTestedAt(config?.last_tested_at || '');
    setApiKey('');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError('');
    try {
      const data = await apiFetch<LlmSettings>('/settings/llm');
      applySettings(data);
    } catch (err) {
      setPageError(getErrorMessage(err, '配置加载失败'));
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => { void load(); }, [load]);

  const baseUrlError = baseUrl.trim() && !validBaseUrl(baseUrl)
    ? '须为合法 HTTPS 地址，或本机 http://localhost / http://127.0.0.1'
    : '';
  const canSave = configName.trim().length > 0
    && validBaseUrl(baseUrl)
    && model.trim().length > 0
    && (configured || apiKey.trim().length > 0)
    && !saving && !testing && !deleting;

  /** PUT /api/settings/llm 请求体。 */
  const buildSavePayload = () => ({
    config_name: configName.trim(),
    base_url: baseUrl.trim(),
    model: model.trim(),
    is_enabled: isEnabled,
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
    ...(localTestedAt || savedTestedAt ? { last_tested_at: localTestedAt || savedTestedAt } : {}),
  });

  /** POST /api/settings/llm/test 请求体（api_key 省略时复用本人已存密文）。 */
  const buildTestPayload = (): LlmTestPayload => ({
    config_name: configName.trim(),
    base_url: baseUrl.trim(),
    model: model.trim(),
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
  });

  const handleTest = async () => {
    if (!validBaseUrl(baseUrl) || !model.trim()) {
      show('请先填写合法的接口地址与模型名称', 'warning');
      return;
    }
    setTesting(true);
    setTestResult(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10500);
    try {
      const result = await apiFetch<TestConnectionResult>('/settings/llm/test', {
        method: 'POST',
        body: JSON.stringify(buildTestPayload()),
        signal: controller.signal,
      });
      setTestResult(result);
      if (result.ok) {
        setLocalTestedAt(new Date().toISOString());
        show(`连接成功（耗时 ${(result.latencyMs / 1000).toFixed(1)}s）`, 'success');
      } else {
        show(result.message, 'error');
      }
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError'
        ? '测试连接超过 10 秒，已自动结束'
        : getErrorMessage(err, '测试连接失败');
      setTestResult({ ok: false, latencyMs: 10000, message });
      show(message, 'error');
    } finally {
      window.clearTimeout(timer);
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const data = await apiFetch<LlmSettings>('/settings/llm', {
        method: 'PUT',
        body: JSON.stringify(buildSavePayload()),
      });
      applySettings(data);
      setLocalTestedAt('');
      show('配置已加密保存', 'success');
    } catch (err) {
      show(getErrorMessage(err, '保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const data = await apiFetch<LlmDeleteResult>('/settings/llm', { method: 'DELETE' });
      setConfirmOpen(false);
      setTestResult(null);
      setLocalTestedAt('');
      show(
        data.effectiveSource === 'env'
          ? '配置已删除，生成回落到部署配置'
          : '配置已删除，生成回落到规则化生成',
        'success',
      );
      await load();
    } catch (err) {
      show(getErrorMessage(err, '删除失败'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const source: ConfigSource = settings?.effectiveSource || 'none';
  const sourceTitle = source === 'user'
    ? '已生效 · 来源是「我的配置」'
    : source === 'env'
      ? '当前生效来源：部署配置（环境变量）'
      : '未配置 · 当前为规则化生成';
  const SourceIcon = source === 'none' ? RuleIcon : source === 'env' ? EnvIcon : AiIcon;
  const activeConfig = settings?.config || null;

  if (loading) return <LoadingState message="正在加载模型配置…" />;

  return (
    <Box className="ra-page">
      <PageHeader
        title="设置 · 模型配置"
        description="填入你自己的 OpenAI 兼容密钥，用你的额度生成简历；也可由部署者通过环境变量统一配置。"
      />

      {/* 当前生效来源状态条（effectiveSource 来自 GET 响应） */}
      <Box
        role="status"
        aria-live="polite"
        sx={{
          mb: 2, p: 2, borderRadius: 2, border: '1px solid',
          borderColor: source === 'none' ? '#FCD34D' : '#BFDBFE',
          background: source === 'none' ? '#FFFBEB' : '#EFF6FF',
          color: source === 'none' ? '#92400E' : '#1E3A8A',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <SourceIcon fontSize="small" sx={{ mt: '3px' }} />
          <Box>
            <Typography variant="body1" fontWeight={800}>{sourceTitle}</Typography>
            <Typography variant="caption" sx={{ display: 'block' }}>
              优先级：用户级已启用配置（我的配置） &gt; 部署环境变量 &gt; 均无则规则化生成。
              选定来源调用失败时本次直接降级，不会自动切换到另一密钥来源。
            </Typography>
            {source === 'user' && activeConfig && (
              <Typography variant="caption" sx={{ display: 'block' }}>
                当前配置：{activeConfig.config_name} · {activeConfig.model} · 最近测试 {formatTime(activeConfig.last_tested_at || '')}
              </Typography>
            )}
            {configured && activeConfig && !activeConfig.is_enabled && (
              <Typography variant="caption" sx={{ display: 'block' }}>
                你已保存用户配置但未启用，启用后会自动覆盖部署配置（当前生效：{source === 'env' ? '部署配置' : '规则化生成'}）。
              </Typography>
            )}
          </Box>
        </Stack>
      </Box>

      {pageError && <Alert severity="error" sx={{ mb: 2 }}>{pageError}</Alert>}

      {!configured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          尚未添加用户级配置。当前生成由{source === 'env' ? '部署配置（环境变量）' : '本地规则化生成器'}承担；
          填写下方表单即可切换为你自己的密钥。
        </Alert>
      )}

      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Grid container spacing={1}>
            <Grid item xs={12} sm={6}>
              <FormField
                label="配置名称" value={configName}
                onChange={(event) => setConfigName(event.target.value)}
                helperText="仅本人可见，便于区分不同模型"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormField
                label="模型名称" value={model}
                onChange={(event) => setModel(event.target.value)}
                helperText="可自由填写任意 OpenAI 兼容模型名"
              />
            </Grid>
            <Grid item xs={12}>
              <FormField
                label="接口地址 base_url" value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                errorText={baseUrlError}
                helperText="例如 https://api.openai.com/v1；本机服务可用 http://localhost:11434/v1"
              />
            </Grid>
            <Grid item xs={12}>
              <PasswordField
                label={configured ? 'API 密钥（留空表示沿用已保存密钥）' : 'API 密钥'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                helperText={configured && savedMask
                  ? `已保存密钥：${savedMask}（仅末 4 位可见，明文不会回显）`
                  : '密钥仅用于你本人的简历生成，服务端 AES-256-GCM 加密存储'}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={<Switch checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} />}
                label="启用此配置（关闭后不再优先使用，将回落到部署配置或规则化生成）"
                sx={{ minHeight: 44 }}
              />
            </Grid>
          </Grid>

          {testResult && (
            <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ mt: 1.5 }}>
              {testResult.ok ? '连接成功' : '连接失败'} · 耗时 {(testResult.latencyMs / 1000).toFixed(1)}s · {testResult.message}
            </Alert>
          )}

          <Alert severity="warning" sx={{ mt: 2 }}>
            风险提示：密钥仅用于你本人的简历生成，服务端加密存储；请勿使用共享/公用密钥。
            未配置或调用失败时，系统将自动使用规则化生成，简历仍可正常生成。
            测试连接不会保存配置、不会生成简历、不会回显密钥明文。
          </Alert>

          <Stack direction="row" spacing={1} sx={{ mt: 2.5, flexWrap: 'wrap', gap: 1 }}>
            <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
              disabled={!canSave} onClick={() => { void handleSave(); }} sx={{ minHeight: 44 }}>
              {saving ? '保存中…' : '保存配置'}
            </Button>
            <Button variant="outlined" startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <TestIcon />}
              disabled={testing || saving || !validBaseUrl(baseUrl) || !model.trim()}
              onClick={() => { void handleTest(); }} sx={{ minHeight: 44 }}>
              {testing ? '测试中…' : '测试连接'}
            </Button>
            <Button color="error" variant="outlined" startIcon={<DeleteIcon />}
              disabled={!configured || deleting || saving} onClick={() => setConfirmOpen(true)} sx={{ minHeight: 44 }}>
              删除配置
            </Button>
            <Chip label={`最近测试：${formatTime(localTestedAt || savedTestedAt)}`} size="small" variant="outlined" sx={{ alignSelf: 'center' }} />
          </Stack>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="删除模型配置"
        message="删除后该密钥密文不可恢复；若未配置其他密钥，生成将自动回退到规则化生成。确认删除？"
        confirmText="确认删除"
        danger
        loading={deleting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { void handleDelete(); }}
      />
    </Box>
  );
}
