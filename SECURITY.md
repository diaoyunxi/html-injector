# 安全策略

## 报告安全漏洞

如果你发现了安全漏洞，请通过以下方式报告：

1. **请勿**在公开的 GitHub Issue 中报告安全漏洞
2. 请通过 GitHub 的 [Security Advisories](https://github.com/diaoyunxi/html-injector/security/advisories/new) 页面提交报告
3. 或直接联系仓库维护者

## 报告内容

请在报告中包含：

- 漏洞类型（XSS、CSRF、代码注入等）
- 受影响的功能和文件
- 复现步骤（PoC）
- 潜在影响评估

## 响应时间

- 确认收到：2 个工作日内
- 初步评估：5 个工作日内
- 修复发布：根据严重程度，1-14 个工作日内

## 安全范围

以下属于本项目的安全关注点：

- HTML 代码注入检测绕过
- CSP（Content Security Policy）绕过
- Chrome 扩展权限滥用
- 恶意代码通过注入检测逃逸
