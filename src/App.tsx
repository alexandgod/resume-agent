/**
 * 前端路由表与鉴权守卫。
 * - 私有页面统一套 AppLayout；
 * - 公开查看页 /s/:token 不套 Layout、不读登录态；
 * - 未登录访问私有页 100% 跳 /login?redirect=当前地址。
 */
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout, LoadingState } from './components/shell';
import { useAuth } from './store/authStore';
import AuthPage from './pages/AuthPage';
import MaterialsPage from './pages/MaterialsPage';
import TemplatesPage from './pages/TemplatesPage';
import ResumeEditPage from './pages/ResumeEditPage';
import ResumesPage from './pages/ResumesPage';
import SharePage from './pages/SharePage';
import PublicResumePage from './pages/PublicResumePage';
import ModelConfigPage from './pages/ModelConfigPage';

/** 私有路由守卫：未登录带 redirect 回跳，已登录渲染带导航的布局。 */
function PrivateRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <LoadingState fullPage message="正在恢复登录状态…" />;
  }
  if (status === 'guest') {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

/** 工作台入口与资料库为同一主区，保留独立路径便于后续扩展。 */
function WorkspaceRedirect() {
  return <Navigate to="/materials" replace />;
}

export default function App() {
  return (
    <Routes>
      {/* 公开：登录 / 注册 */}
      <Route path="/login" element={<AuthPage />} />
      {/* 公开：扫码只读查看，不套 Layout */}
      <Route path="/s/:token" element={<PublicResumePage />} />

      {/* 私有页面 */}
      <Route path="/workspace" element={<PrivateRoute><WorkspaceRedirect /></PrivateRoute>} />
      <Route path="/materials" element={<PrivateRoute><MaterialsPage /></PrivateRoute>} />
      <Route path="/templates" element={<PrivateRoute><TemplatesPage /></PrivateRoute>} />
      <Route path="/resumes" element={<PrivateRoute><ResumesPage /></PrivateRoute>} />
      <Route
        path="/resumes/:id/edit"
        element={<PrivateRoute><ResumeEditPage /></PrivateRoute>}
      />
      <Route
        path="/resumes/:id/share"
        element={<PrivateRoute><SharePage /></PrivateRoute>}
      />
      <Route
        path="/settings/llm"
        element={<PrivateRoute><ModelConfigPage /></PrivateRoute>}
      />

      {/* 未知路径 */}
      <Route path="*" element={<Navigate to="/workspace" replace />} />
    </Routes>
  );
}
