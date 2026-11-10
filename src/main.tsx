/**
 * 前端入口：挂载 React 18、路由、MUI 中文主题与全局状态/提示上下文。
 * 所有 UI 文案均为简体中文。
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { zhCN } from '@mui/material/locale';
import App from './App';
import { AuthProvider } from './store/authStore';
import { ToastProvider } from './components/shell';
import './index.css';

/** 中性蓝灰主题，保证正文对比度 ≥ 4.5:1。 */
const theme = createTheme(
  {
    palette: {
      primary: { main: '#2563EB', dark: '#1D4ED8', light: '#3B82F6' },
      secondary: { main: '#1E3A5F' },
      background: { default: '#F5F7FA', paper: '#FFFFFF' },
      text: { primary: '#1F2937', secondary: '#4B5563' },
    },
    typography: {
      fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif',
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 10 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { minHeight: 44, minWidth: 64 } },
      },
      MuiIconButton: {
        styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
    },
  },
  zhCN,
);

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到挂载节点 #root');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
