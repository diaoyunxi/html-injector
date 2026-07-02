/**
 * HTML 注入器 - 后台服务工作者
 * 
 * 核心注入逻辑：
 * 使用 chrome.scripting.executeScript 配合 world: "MAIN"
 * 将代码直接注入页面的主世界（MAIN world），绕过内容脚本隔离限制
 * 
 * 同时配合 declarativeNetRequest 移除 CSP 头，确保外部脚本不会被阻止
 * 
 * 注入时机：
 * - immediate：页面开始加载时（tabs.onUpdated status=loading）
 * - dom_ready：页面加载完成时（tabs.onUpdated status=complete）
 */

// 当前扩展版本
var CURRENT_VERSION = "1.0.2";

// GitHub 仓库 API 地址
var RELEASES_API = "https://api.github.com/repos/diaoyunxi/html-injector/releases/latest";

/**
 * 比较版本号
 * @param {string} current - 当前版本
 * @param {string} latest - 最新版本
 * @returns {boolean} 是否有新版本
 */
function isNewerVersion(current, latest) {
  var currentParts = current.split(".").map(Number);
  var latestParts = latest.split(".").map(Number);
  var maxLen = Math.max(currentParts.length, latestParts.length);
  for (var i = 0; i < maxLen; i++) {
    var c = currentParts[i] || 0;
    var l = latestParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * 检查更新
 * 启动时自动调用，从 GitHub 获取最新 Release 信息
 */
function checkForUpdate() {
  fetch(RELEASES_API)
    .then(function (resp) {
      if (!resp.ok) return null;
      return resp.json();
    })
    .then(function (data) {
      if (!data || !data.tag_name) return;
      var latestVersion = data.tag_name.replace(/^v/, "");
      if (isNewerVersion(CURRENT_VERSION, latestVersion)) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "HTML 注入器 - 发现新版本",
          message: "新版本 v" + latestVersion + " 已发布，请前往 GitHub 下载更新。",
          priority: 2,
        });
        chrome.storage.local.set({
          updateAvailable: true,
          latestVersion: latestVersion,
          releaseUrl: data.html_url,
        });
      }
    })
    .catch(function () {});
}

/**
 * 向指定标签页注入 HTML 代码
 * 使用 chrome.scripting.executeScript 配合 world: "MAIN"
 * 在页面的主世界中执行，创建的 script 标签会正常加载和执行
 * @param {number} tabId - 标签页 ID
 * @param {string} htmlCode - 要注入的 HTML 代码
 */
function injectHtml(tabId, htmlCode) {
  chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: true },
    world: "MAIN",
    func: function (code) {
      // 此函数在页面的主世界（MAIN world）中执行
      // 防止重复注入
      if (window.__HTML_INJECTOR_DONE__) return;
      window.__HTML_INJECTOR_DONE__ = true;

      // 用临时容器解析 HTML
      var temp = document.createElement("div");
      temp.innerHTML = code;

      // 获取注入目标：优先 head，回退到 documentElement
      var target = document.head || document.documentElement;

      // 遍历所有子节点逐个插入
      while (temp.firstChild) {
        var node = temp.firstChild;

        if (node.nodeType === 1 && node.tagName === "SCRIPT") {
          // script 标签必须用 createElement 重新创建才会执行
          // 这是浏览器的安全机制：通过 innerHTML 插入的 script 不会执行
          var script = document.createElement("script");

          // 复制所有属性（src、type、async、defer、crossorigin 等）
          for (var i = 0; i < node.attributes.length; i++) {
            var attr = node.attributes[i];
            script.setAttribute(attr.name, attr.value);
          }

          // 如果有内联代码，设置 textContent
          if (node.textContent) {
            script.textContent = node.textContent;
          }

          target.appendChild(script);
          temp.removeChild(node);
        } else {
          // 非 script 元素直接移动到目标位置
          target.appendChild(node);
        }
      }
    },
    args: [htmlCode],
  }).catch(function (e) {
    // 忽略注入错误（如 chrome:// 等特殊页面）
  });
}

/**
 * 监听标签页更新事件
 * 根据用户选择的注入时机，在页面加载的不同阶段注入代码
 */
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  // 只处理 http/https 页面
  if (!tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
    return;
  }

  // 读取配置
  chrome.storage.local.get(
    ["enabled", "htmlCode", "injectTiming"],
    function (result) {
      var enabled = result.enabled || false;
      var htmlCode = result.htmlCode || "";
      var timing = result.injectTiming || "immediate";

      // 未启用或无代码则退出
      if (!enabled || !htmlCode) return;

      // 根据注入时机判断是否应该注入
      if (timing === "immediate") {
        // 立即注入：页面开始加载时
        if (changeInfo.status === "loading") {
          injectHtml(tabId, htmlCode);
        }
      } else if (timing === "dom_ready") {
        // DOM 就绪后注入：页面加载完成时
        if (changeInfo.status === "complete") {
          injectHtml(tabId, htmlCode);
        }
      }
    }
  );
});

/**
 * 监听开关状态变化
 * 当用户打开开关时，立即向当前活动标签页注入代码
 */
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== "local") return;

  // 如果开关被打开或代码被修改，且当前是开启状态
  if (changes.enabled || changes.htmlCode) {
    chrome.storage.local.get(["enabled", "htmlCode"], function (result) {
      if (result.enabled && result.htmlCode) {
        // 向当前活动标签页注入
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs[0] && tabs[0].url && 
              (tabs[0].url.startsWith("http://") || tabs[0].url.startsWith("https://"))) {
            injectHtml(tabs[0].id, result.htmlCode);
          }
        });
      }
    });
  }
});

// 通知点击事件 - 打开发布页面
chrome.notifications.onClicked.addListener(function (notificationId) {
  chrome.storage.local.get(["releaseUrl"], function (result) {
    if (result.releaseUrl) {
      chrome.tabs.create({ url: result.releaseUrl });
    }
  });
  chrome.notifications.clear(notificationId);
});

// 扩展安装/启动时检查更新
chrome.runtime.onInstalled.addListener(checkForUpdate);
chrome.runtime.onStartup.addListener(checkForUpdate);
