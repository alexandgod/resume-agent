/**
 * 通用外壳组件：四类状态组件、ConfirmDialog 二次确认、Toast、表单字段、
 * 顶部/侧导航、用户下拉（含「设置」入口）、生成来源标识条。
 * 依赖方向：components → store / types（不直接调用 api）。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { TextFieldProps } from '@mui/material/TextField';
import {
  Menu as MenuIcon,
  Visibility,
  VisibilityOff,
  Settings as SettingsIcon,
  Logout as LogoutIcon,
  DeleteForever as DeleteForeverIcon,
  Dashboard as DashboardIcon,
  Description as DescriptionIcon,
  Style as StyleIcon,
  FolderOpen as FolderOpenIcon,
  ExpandMore as ExpandMoreIcon,
  SmartToy as SmartToyIcon,
  Rule as RuleIcon,
  InfoOutlined as InfoIcon,
  CheckCircleOutline as SuccessIcon,
  ErrorOutline as ErrorIcon,
  HourglassEmpty as PendingIcon,
  InboxOutlined as EmptyIcon,
  Refresh as RefreshIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { useAuth } from '../store/authStore';

/**
 * 统一提取可读错误信息（不回显任何密钥或堆栈）。
 * components 层不 import api：所有异常都按标准 Error 处理，避免反向依赖。
 */
export function getErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

// ── Toast ────────────────────────────────────────────────────────
type ToastSeverity = 'success' | 'error' | 'warning' | 'info';

interface ToastApi {
  show: (message: string, severity?: ToastSeverity) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<ToastSeverity>('info');

  const show = useCallback((text: string, level: ToastSeverity = 'info') => {
    setMessage(text);
    setSeverity(level);
    setOpen(true);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={3200}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setOpen(false)}
          severity={severity}
          variant="filled"
          sx={{ width: '100%', fontSize: 14 }}
        >
          {message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

// ── 四类状态组件 ─────────────────────────────────────────────────
export function LoadingState({ fullPage = false, message = '正在加载…' }: {
  fullPage?: boolean;
  message?: string;
}) {
  return (
    <Box
      sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: fullPage ? '70vh' : 180, gap: 2, p: 3, width: '100%',
      }}
    >
      <CircularProgress size={36} />
      <Typography variant="body2" color="text.secondary">{message}</Typography>
    </Box>
  );
}

export function EmptyState({ title, description, action }: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
      <EmptyIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
      <Typography variant="h6" sx={{ mt: 1.5 }}>{title}</Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>{action}</Box>}
    </Box>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2 }}>
      <ErrorIcon color="error" sx={{ fontSize: 48 }} />
      <Typography variant="h6" sx={{ mt: 1 }}>出错了</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>{message}</Typography>
      {onRetry && (
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={onRetry} sx={{ minHeight: 44 }}>
          重新尝试
        </Button>
      )}
    </Box>
  );
}

export function SuccessState({ title, description }: { title: string; description?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2 }}>
      <SuccessIcon color="success" sx={{ fontSize: 48 }} />
      <Typography variant="h6" sx={{ mt: 1 }}>{title}</Typography>
      {description && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{description}</Typography>}
    </Box>
  );
}

// ── 二次确认统一弹窗 ─────────────────────────────────────────────
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open, title, message, confirmText = '确认', cancelText = '取消',
  danger = false, loading = false, onCancel, onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onCancel} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: 'text.primary', lineHeight: 1.8 }}>{message}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onCancel} disabled={loading} sx={{ minHeight: 44 }}>{cancelText}</Button>
        <Button
          onClick={onConfirm}
          disabled={loading}
          variant="contained"
          color={danger ? 'error' : 'primary'}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ minHeight: 44 }}
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── 表单字段 ─────────────────────────────────────────────────────
export interface FormFieldProps extends Omit<TextFieldProps, 'label' | 'error' | 'helperText'> {
  label: string;
  errorText?: string;
  helperText?: string;
}

export function FormField({ label, errorText, helperText, ...rest }: FormFieldProps) {
  return (
    <TextField
      {...rest}
      label={label}
      fullWidth
      margin="normal"
      error={Boolean(errorText)}
      helperText={errorText || helperText || ' '}
      inputProps={{ ...(rest.inputProps || {}), 'aria-label': label }}
    />
  );
}

export interface PasswordFieldProps extends Omit<TextFieldProps, 'label' | 'type' | 'error' | 'helperText'> {
  label: string;
  errorText?: string;
  helperText?: string;
}

/** 密码框：type="password" + 显隐切换（P1/P8 复用）。 */
export function PasswordField({ label, errorText, helperText, ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...rest}
      label={label}
      type={visible ? 'text' : 'password'}
      fullWidth
      margin="normal"
      error={Boolean(errorText)}
      helperText={errorText || helperText || ' '}
      inputProps={{ ...(rest.inputProps || {}), 'aria-label': label }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              aria-label={visible ? '隐藏输入内容' : '显示输入内容'}
              onClick={() => setVisible((value) => !value)}
              edge="end"
              size="small"
            >
              {visible ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}

// ── 页面标题区 ───────────────────────────────────────────────────
export function PageHeader({ title, description, actions }: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <Box sx={{ mb: 2.5, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
      <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
        <Typography variant="h5" fontWeight={800} sx={{ lineHeight: 1.35 }}>{title}</Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{description}</Typography>
        )}
      </Box>
      {actions && (
        <Box className="ra-no-print" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>
      )}
    </Box>
  );
}

// ── 生成来源标识条（5.4 四态） ───────────────────────────────────
export interface GenerationSourceBarProps {
  generationMode?: string;
  configSource?: string;
  degradedReason?: string;
}

export function GenerationSourceBar({
  generationMode = 'manual', configSource = 'none', degradedReason = '',
}: GenerationSourceBarProps) {
  const kind: 'ai' | 'rule' | 'manual' = generationMode === 'ai'
    ? 'ai'
    : generationMode === 'rule' ? 'rule' : 'manual';

  let title = '尚未生成 · 可手动填写，或点击「一键生成」';
  if (kind === 'ai') {
    title = configSource === 'user'
      ? 'AI 生成 · 来源是「我的配置」'
      : configSource === 'env'
        ? 'AI 生成 · 来源是「部署配置」'
        : 'AI 生成';
  } else if (kind === 'rule') {
    title = '当前为规则化生成';
  }

  const Icon = kind === 'ai' ? SmartToyIcon : kind === 'rule' ? RuleIcon : InfoIcon;

  return (
    <Box
      className={`ra-source-bar ra-source-bar--${kind}`}
      role="status"
      aria-live="polite"
      sx={kind === 'manual' ? { background: '#F3F4F6', borderColor: '#E5E7EB', color: '#374151' } : {}}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Icon fontSize="small" sx={{ mt: '3px', flexShrink: 0 }} />
        <Box>
          <Typography variant="body2" fontWeight={700}>{title}</Typography>
          {kind === 'rule' && configSource !== 'none' && (
            <Typography variant="caption" sx={{ display: 'block' }}>
              配置调用失败，已自动降级为规则化生成（保留本次来源：{configSource === 'user' ? '我的配置' : '部署配置'}）
            </Typography>
          )}
          {degradedReason && (
            <Typography variant="caption" sx={{ display: 'block' }}>{degradedReason}</Typography>
          )}
          {kind === 'rule' && configSource === 'none' && (
            <Typography variant="caption" sx={{ display: 'block' }}>
              未配置大模型密钥，系统使用本地规则化生成，简历仍可正常编辑与分享。
            </Typography>
          )}
          {kind === 'ai' && (
            <Typography variant="caption" sx={{ display: 'block' }}>
              本次结果由已生效的 OpenAI 兼容配置生成，密钥仅在服务端本次请求内使用。
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  );
}

// ── 应用布局与导航 ───────────────────────────────────────────────
interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { label: '工作台', path: '/workspace', icon: <DashboardIcon /> },
  { label: '资料库', path: '/materials', icon: <DescriptionIcon /> },
  { label: '模板库', path: '/templates', icon: <StyleIcon /> },
  { label: '我的简历', path: '/resumes', icon: <FolderOpenIcon /> },
];

/** 带顶部导航、用户下拉（含「设置」）与移动端抽屉的私有页面布局。 */
export function AppLayout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, deleteAccount } = useAuth();
  const { show } = useToast();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = (path: string) => {
    setDrawerOpen(false);
    navigate(path);
  };

  const isActive = (path: string) => (
    path === '/workspace'
      ? location.pathname === '/workspace' || location.pathname === '/materials'
      : location.pathname.startsWith(path)
  );

  const handleLogout = async () => {
    setMenuAnchor(null);
    await logout();
    show('已退出登录', 'success');
    navigate('/login');
  };

  const handleDeleteAccount = async () => {
    setBusy(true);
    try {
      await deleteAccount();
      show('账号已注销，相关数据已清理', 'success');
      setConfirmOpen(false);
      navigate('/login');
    } catch (error) {
      show(getErrorMessage(error, '注销失败，请稍后重试'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppBar
        position="sticky"
        className="ra-no-print"
        color="default"
        elevation={1}
        sx={{ bgcolor: '#FFFFFF' }}
      >
        <Toolbar sx={{ gap: 0.5, minHeight: { xs: 56, sm: 64 } }}>
          {isMobile && (
            <IconButton aria-label="打开导航菜单" onClick={() => setDrawerOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Box
            onClick={() => go('/workspace')}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', minHeight: 44 }}
          >
            <Avatar sx={{ bgcolor: 'primary.main', width: 34, height: 34, fontWeight: 700 }}>简</Avatar>
            <Typography variant="h6" fontWeight={800} sx={{ whiteSpace: 'nowrap' }}>简历 Agent</Typography>
          </Box>

          {!isMobile && (
            <Stack direction="row" spacing={0.5} sx={{ ml: 3 }}>
              {NAV_ITEMS.map((item) => (
                <Button
                  key={item.path}
                  onClick={() => go(item.path)}
                  startIcon={item.icon}
                  variant={isActive(item.path) ? 'contained' : 'text'}
                  sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
                >
                  {item.label}
                </Button>
              ))}
            </Stack>
          )}

          <Box sx={{ flex: 1 }} />
          <Tooltip title="账号与设置">
            <Button
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              startIcon={<PersonIcon />}
              endIcon={<ExpandMoreIcon />}
              sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              {user?.username || '我的账号'}
            </Button>
          </Tooltip>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem onClick={() => { setMenuAnchor(null); go('/settings/llm'); }}>
              <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>设置 · 模型配置</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { setMenuAnchor(null); setConfirmOpen(true); }}>
              <ListItemIcon><DeleteForeverIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText>注销账号</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { void handleLogout(); }}>
              <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
              <ListItemText>退出登录</ListItemText>
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        className="ra-no-print"
        PaperProps={{ sx: { width: 268 } }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Avatar sx={{ bgcolor: 'primary.main' }}>简</Avatar>
          <Typography fontWeight={800}>简历 Agent</Typography>
        </Box>
        <Divider />
        <List sx={{ p: 1 }}>
          {NAV_ITEMS.map((item) => (
            <ListItemButton
              key={item.path}
              selected={isActive(item.path)}
              onClick={() => go(item.path)}
              sx={{ minHeight: 48, borderRadius: 1 }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
          <Divider sx={{ my: 1 }} />
          <ListItemButton onClick={() => go('/settings/llm')} sx={{ minHeight: 48, borderRadius: 1 }}>
            <ListItemIcon><SettingsIcon /></ListItemIcon>
            <ListItemText primary="设置 · 模型配置" />
          </ListItemButton>
          <ListItemButton onClick={() => { setDrawerOpen(false); void handleLogout(); }} sx={{ minHeight: 48, borderRadius: 1 }}>
            <ListItemIcon><LogoutIcon /></ListItemIcon>
            <ListItemText primary="退出登录" />
          </ListItemButton>
        </List>
      </Drawer>

      <Box
        component="main"
        className="ra-page"
        sx={{ px: { xs: 1.5, sm: 3, md: 4 }, py: { xs: 2, md: 3 }, width: '100%', overflowX: 'hidden' }}
      >
        <Container maxWidth={false} disableGutters sx={{ maxWidth: 1440, mx: 'auto' }}>
          {children}
        </Container>
      </Box>

      <ConfirmDialog
        open={confirmOpen}
        title="注销账号"
        message="注销后你的简历、资料、分享链接与模型配置将被永久删除且不可恢复，已发出的分享链接同时失效。确认继续？"
        confirmText="确认注销"
        danger
        loading={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { void handleDeleteAccount(); }}
      />
    </>
  );
}

/** 小状态标签（解析状态 / 简历状态等），文字与颜色同时传达状态。 */
export function StatusChip({ label, tone = 'default' }: {
  label: string;
  tone?: 'default' | 'success' | 'warning' | 'error' | 'info';
}) {
  const colorMap: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    default: 'default', success: 'success', warning: 'warning', error: 'error', info: 'info',
  };
  return <Chip label={label} color={colorMap[tone] || 'default'} size="small" variant="outlined" />;
}

/** 等待态小组件（生成进度、测试连接等复用）。 */
export function PendingHint({ text }: { text: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <PendingIcon fontSize="small" color="action" />
      <Typography variant="body2" color="text.secondary">{text}</Typography>
    </Stack>
  );
}
