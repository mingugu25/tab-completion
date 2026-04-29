# Tab Completion MVP

一个最简单可运行的补全项目：

- 按 `Tab` 触发补全
- 获取光标前最近 `100` 字符
- 调用 `/v1/completions`
- 将返回的补全文本插入到当前光标

## 运行

```bash
npm install
npm start
```

打开 `http://localhost:3000` 即可测试。

## 结构

- `server.js`：Express 服务和补全接口
- `public/index.html`：简单编辑器页面
- `public/main.js`：Tab 触发、请求、插入逻辑
