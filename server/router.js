'use strict';

// 声明式路由表：两级查找（精确 Map O(1) + 参数化正则线性），
// 支持路径参数（:id）与方法过滤，命中即返回 ctx 供 handler 消费。

const exactRoutes = new Map();   // "METHOD /path" -> { handler, permission }
const paramRoutes = [];          // { method, regex, keys, handler, permission }

function addRoute(method, pattern, options, handler) {
  const permission = (options || {}).permission || null;
  const keys = [];
  const hasParams = pattern.includes(':');
  if (!hasParams) {
    exactRoutes.set(`${method} ${pattern}`, { handler, permission });
    return;
  }
  // :name# 约束纯数字段（等价原 if 链的 (\d+) 正则），:name 匹配任意单段
  const source = pattern.replace(/:([a-zA-Z]+)(#)?/g, (_, key, digits) => {
    keys.push(key);
    return digits ? '(\\d+)' : '([^/]+)';
  });
  paramRoutes.push({
    method,
    pattern,
    regex: new RegExp(`^${source}$`),
    keys,
    handler,
    permission
  });
}

function matchRoute(method, pathname) {
  const exact = exactRoutes.get(`${method} ${pathname}`);
  if (exact) return { handler: exact.handler, permission: exact.permission, params: {} };
  for (const r of paramRoutes) {
    if (r.method !== method) continue;
    const match = pathname.match(r.regex);
    if (!match) continue;
    const params = {};
    r.keys.forEach((key, i) => { params[key] = decodeURIComponent(match[i + 1]); });
    return { handler: r.handler, permission: r.permission, params };
  }
  return null;
}

// 启动期校验用：确认 "METHOD /pattern" 键确实注册过（防权限表键名漂移静默丢权限门）
function hasRoute(key) {
  if (exactRoutes.has(key)) return true;
  return paramRoutes.some(r => `${r.method} ${r.pattern}` === key);
}

function clearRoutes() {
  exactRoutes.clear();
  paramRoutes.length = 0;
}

module.exports = { addRoute, matchRoute, hasRoute, clearRoutes };
