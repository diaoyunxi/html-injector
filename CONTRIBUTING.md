# 贡献指南

感谢你对 html-injector 项目的关注！

## 安全注意事项

本项目处理 HTML 代码注入检测，修改时请特别注意：

- XSS 防护规则的完整性（`background.js` 中的危险模式检测）
- HTML 实体解码和空白字符绕过的覆盖
- CSP（Content Security Policy）声明的正确性
- 新增检测规则时需添加对应的测试用例

## 代码规范

- JavaScript 代码遵循现有风格
- 提交前确保 Chrome 扩展可以正常加载
- 新增的危险代码模式需同步更新检测正则

## 提交 Pull Request

1. Fork 本仓库并创建功能分支
2. 在 Chrome 中测试扩展功能
3. 如涉及安全规则修改，请提供绕过/绕过的测试用例
4. 遵循 Conventional Commits 规范提交
