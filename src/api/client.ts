/**
 * 请求层：全站唯一出网口。
 * - apiFetch：私有前缀 /api，读取 localStorage('ra_token') 并附加 Authorization: Bearer；
 *   401 统一清 token 并跳 /login?redirect=当前地址（避免与 authStore 循环依赖）。
 * - publicFetch：公开前缀 /api/public，**绝不读取或附加任何 token**，也不做登录回跳。
 * 依赖方向：api → types（不 import store）。
 */
import type { ApiErrorData, ApiResponse } from '../types';

export const TOKEN_KEY = 'ra_token';

/** 带 code / data 的客户端异常，供页面做字段级与锁定倒计时处理。 */
export class ApiClientError extends Error {
  public readonly code: number;
  public readonly data: ApiErrorData;

  constructor(code: number, message: string, data: ApiErrorData = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.data = data || {};
  }
}

/** 读取 token（只在本文件与 authStore 中使用）。 */
export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** 写入 token。 */
export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 隐私模式下 localStorage 不可用，本次会话仍可用内存态。
  }
}

/** 清除 token。 */
export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 忽略存储异常。
  }
}

/** 读取响应体；解析失败时返回结构化错误而不抛出未捕获异常。 */
async function readPayload<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    return (await response.json()) as ApiResponse<T>;
  } catch {
    return {
      code: response.status >= 400 ? response.status : 500,
      message: '响应格式异常，请稍后重试',
      data: {} as T,
    };
  }
}

function isFormData(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

/**
 * 私有接口请求。
 * @param path 以 / 开头，如 '/auth/login'
 * @param options 原生 fetch 配置（body 为对象时请自行 JSON.stringify）
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !isFormData(options.body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers });
  } catch {
    throw new ApiClientError(0, '网络连接失败，请确认服务已启动', {});
  }

  const payload = await readPayload<T>(response);
  const errorData = (payload.data || {}) as ApiErrorData;

  if (response.status === 401 || payload.code === 401) {
    clearToken();
    const current = window.location.pathname + window.location.search;
    const redirect = encodeURIComponent(current);
    window.location.assign(`/login?redirect=${redirect}`);
    throw new ApiClientError(401, payload.message || '登录状态已失效，请重新登录', errorData);
  }

  if (payload.code !== 0) {
    throw new ApiClientError(Number(payload.code), payload.message || '请求失败', errorData);
  }
  return payload.data;
}

/**
 * 公开接口请求（扫码只读页专用）。
 * 不读取 localStorage、不附加 Authorization、不触发登录跳转。
 */
export async function publicFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  // 公开请求不携带任何凭据，也不允许调用方传入 Authorization。
  headers.delete('Authorization');

  let response: Response;
  try {
    response = await fetch(`/api/public${path}`, { ...options, headers, credentials: 'omit' });
  } catch {
    throw new ApiClientError(0, '网络连接失败，请稍后重试', {});
  }

  const payload = await readPayload<T>(response);
  if (payload.code !== 0) {
    throw new ApiClientError(
      Number(payload.code),
      payload.message || '请求失败',
      (payload.data || {}) as ApiErrorData,
    );
  }
  return payload.data;
}
