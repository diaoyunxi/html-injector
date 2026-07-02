# HTML 注入器

一个简洁实用的 Chrome 浏览器扩展，用于在网页 `<head>` 中插入自定义 HTML 代码。

## 功能特点

- **全局开关**：一个开关控制所有网站的注入行为，无需逐个网站配置
- **持久存储**：HTML 代码和设置自动保存，重启浏览器后依然有效
- **自定义注入时机**：支持「立即注入」和「DOM 就绪后注入」两种时机
- **所有网站生效**：在所有网页上自动注入，无需手动添加域名
- **自动保存**：修改代码后自动保存，也提供手动保存按钮
- **自动更新检查**：扩展启动时自动检查 GitHub 上的新版本
- **防重复注入**：智能防止同一页面多次注入
- **CSP 绕过**：自动移除页面的内容安全策略（CSP）头，确保外部脚本可正常加载
- **主世界注入**：使用 `chrome.scripting` 配合 `world: "MAIN"` 在页面主世界执行代码，script 标签可正常执行

## 安装方法

1. 下载最新版本的 ZIP 文件（从 [Releases](https://github.com/diaoyunxi/html-injector/releases) 页面下载）
2. 解压 ZIP 文件到一个文件夹
3. 打开 Chrome 浏览器，进入 `chrome://extensions/`
4. 开启右上角的「开发者模式」
5. 点击「加载已解压的扩展程序」，选择解压后的文件夹
6. 扩展图标将出现在浏览器工具栏中

## 使用方法

1. 点击浏览器工具栏中的扩展图标，打开弹窗
2. 打开开关（开关变为绿色表示已开启）
3. 在文本框中输入要注入的 HTML 代码，例如：
   ```html
   <meta name="author" content="我的名字">
   <style>body { background: #f0f0f0; }</style>
   <script src="https://fastly.jsdelivr.net/npm/live2d-widgets@1.0.1/dist/autoload.js"></script>
   ```
4. 选择注入时机：
   - **立即注入**：页面开始加载时注入（推荐，适合需要尽早生效的代码）
   - **DOM 就绪后注入**：页面加载完成后注入（适合需要 DOM 已构建的场景）
5. 代码会自动保存，也可点击「手动保存」按钮
6. 开关打开后，所有打开的网页都会自动注入代码

## 使用场景

- 添加自定义 meta 标签
- 注入自定义 CSS 样式
- 添加外部 JS 库（如 live2d 看板娘、统计代码等）
- 添加统计或调试脚本
- 修改网页默认行为
- 开发调试时注入测试代码

## 项目结构

```
html-injector/
├── manifest.json      # 扩展清单文件（Manifest V3）
├── popup.html         # 弹窗界面
├── popup.css          # 弹窗样式
├── popup.js           # 弹窗逻辑
├── background.js      # 后台服务工作者（注入逻辑 + 检查更新）
├── rules.json         # declarativeNetRequest 规则（移除 CSP 头）
├── icons/             # 图标文件
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── LICENSE            # MIT 许可证
└── README.md          # 说明文档
```

## 技术说明

- 基于 Chrome Extension Manifest V3 开发
- 使用 `chrome.storage.local` 持久化存储配置
- 使用 `chrome.scripting.executeScript` 配合 `world: "MAIN"` 在页面主世界注入代码
- 使用 `declarativeNetRequest` 移除 CSP 头，确保外部脚本不被阻止
- script 标签通过 `document.createElement('script')` 显式创建，确保正确执行
- 监听 `chrome.tabs.onUpdated` 在页面加载的不同阶段触发注入
- 监听 `chrome.storage.onChanged` 实现开关打开后立即注入当前页面

## 版本历史

| 版本 | 说明 |
|------|------|
| v1.0.0 | 初始版本，使用 content_scripts + DOMParser |
| v1.0.1 | 修复 script 标签不执行问题，改用 createElement |
| v1.0.2 | 彻底修复：改用 chrome.scripting world:MAIN + declarativeNetRequest 移除 CSP |

## 自动更新

扩展在启动时会自动检查 GitHub Releases 中的最新版本。如果有新版本，会弹出通知提醒用户更新。

## 许可证

MIT License

## 反馈与建议

如有问题或建议，请前往 [GitHub Issues](https://github.com/diaoyunxi/html-injector/issues) 提交。
