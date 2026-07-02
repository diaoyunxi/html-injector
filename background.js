/**
 * HTML 注入器 - 后台服务工作者
 * 
 * 核心注入逻辑：
 * 使用 chrome.scripting.executeScript 配合 world: "MAIN"
 * 将代码直接注入页面的主世界（MAIN world），绕过内容脚本隔离限制
 * 
 * 同时配合 declarativeNetRequest 移除 CSP 头，确保外部脚本不会被阻止
 * 
 * 置顶显示功能：
 * - 注入 CSS 强制高 z-index（2147483647）用于常见 widget 选择器
 * - 使用 MutationObserver 动态捕获脚本创建的元素并提升 z-index
 * - 确保 live2d 等注入内容不被网站 UI 遮挡
 * 
 * 注入时机：
 * - immediate：页面开始加载时（tabs.onUpdated status=loading）
 * - dom_ready：页面加载完成时（tabs.onUpdated status=complete）
 */

// 当前扩展版本
var CURRENT_VERSION = "1.0.3";

// GitHub 仓库 API 地址
var RELEASES_API = "https://api.github.com/repos/diaoyunxi/html-injector/releases/latest";

/**
 * 比较版本号
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
 * @param {boolean} zindexBoost - 是否启用置顶显示（高 z-index）
 */
function injectHtml(tabId, htmlCode, zindexBoost) {
  chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: true },
    world: "MAIN",
    func: function (code, boostZindex) {
      // 此函数在页面的主世界（MAIN world）中执行
      // 防止重复注入
      if (window.__HTML_INJECTOR_DONE__) return;
      window.__HTML_INJECTOR_DONE__ = true;

      // 获取注入目标：优先 head，回退到 documentElement
      var target = document.head || document.documentElement;

      // ============ 置顶显示：注入 CSS + MutationObserver ============
      if (boostZindex) {
        // 1. 注入 CSS：强制常见 widget 选择器使用最高 z-index
        var boostStyle = document.createElement("style");
        boostStyle.id = "__html_injector_zindex_boost__";
        boostStyle.textContent = [
          "/* HTML 注入器 - 置顶显示 */",
          "/* Live2D / 看板娘 */",
          "#waifu, #waifu-tips, #waifu-toggle, #waifu-toggle-tips,",
          ".waifu, .waifu-tips, .waifu-toggle,",
          "div[id*='waifu' i], div[class*='waifu' i],",
          "div[id*='live2d' i], div[class*='live2d' i],",
          "canvas[id*='live2d' i], canvas[id*='waifu' i],",
          "div[id*='L2D' i], div[class*='L2D' i],",
          "/* 通用 widget 容器 */",
          "div[id*='widget' i], div[class*='widget' i],",
          "/* 看板娘工具栏 */",
          "#waifu-tool, .waifu-tool {",
          "  z-index: 2147483647 !important;",
          "}"
        ].join("\n");
        target.appendChild(boostStyle);

        // 2. MutationObserver：动态捕获脚本创建的元素并提升 z-index
        //    脚本（如 live2d autoload.js）会异步创建 DOM 元素，
        //    CSS 选择器可能无法覆盖所有情况，因此用 Observer 补充
        var zObserver = new MutationObserver(function (mutations) {
          mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(function (node) {
              if (node.nodeType !== 1) return;

              // 判断是否为 widget 类元素
              function isWidgetLike(el) {
                var id = (el.id || "").toLowerCase();
                var cls = (el.className || "").toString().toLowerCase();
                // 常见 widget 关键词
                var keywords = ["waifu", "live2d", "l2d", "widget", "kanban"];
                for (var k = 0; k < keywords.length; k++) {
                  if (id.indexOf(keywords[k]) >= 0 || cls.indexOf(keywords[k]) >= 0) {
                    return true;
                  }
                }
                // canvas 元素通常是 widget 的一部分
                if (el.tagName === "CANVAS") return true;
                // 包含 canvas 的固定/绝对定位 div
                if (el.tagName === "DIV") {
                  var style = window.getComputedStyle(el);
                  if ((style.position === "fixed" || style.position === "absolute") &&
                      el.querySelector("canvas")) {
                    return true;
                  }
                }
                return false;
              }

              // 检查当前节点
              if (isWidgetLike(node)) {
                node.style.setProperty("z-index", "2147483647", "important");
              }

              // 检查子孙节点
              if (node.querySelectorAll) {
                var descendants = node.querySelectorAll("div, canvas, iframe, span");
                descendants.forEach(function (child) {
                  if (isWidgetLike(child)) {
                    child.style.setProperty("z-index", "2147483647", "important");
                  }
                });
              }
            });
          });
        });

        // 开始观察整个文档的子树变化
        zObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });

        // 15 秒后停止观察（大多数 widget 在此时间内完成初始化）
        setTimeout(function () {
          zObserver.disconnect();
        }, 15000);
      }

      // ============ 注入用户的 HTML 代码 ============
      var temp = document.createElement("div");
      temp.innerHTML = code;

      while (temp.firstChild) {
        var node = temp.firstChild;

        if (node.nodeType === 1 && node.tagName === "SCRIPT") {
          // script 标签必须用 createElement 重新创建才会执行
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
    args: [htmlCode, zindexBoost],
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
    ["enabled", "htmlCode", "injectTiming", "zindexBoost"],
    function (result) {
      var enabled = result.enabled || false;
      var htmlCode = result.htmlCode || "";
      var timing = result.injectTiming || "immediate";
      var boost = result.zindexBoost !== false; // 默认 true

      // 未启用或无代码则退出
      if (!enabled || !htmlCode) return;

      // 根据注入时机判断是否应该注入
      if (timing === "immediate") {
        if (changeInfo.status === "loading") {
          injectHtml(tabId, htmlCode, boost);
        }
      } else if (timing === "dom_ready") {
        if (changeInfo.status === "complete") {
          injectHtml(tabId, htmlCode, boost);
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

  if (changes.enabled || changes.htmlCode || changes.zindexBoost) {
    chrome.storage.local.get(["enabled", "htmlCode", "zindexBoost"], function (result) {
      if (result.enabled && result.htmlCode) {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs[0] && tabs[0].url &&
              (tabs[0].url.startsWith("http://") || tabs[0].url.startsWith("https://"))) {
            var boost = result.zindexBoost !== false;
            injectHtml(tabs[0].id, result.htmlCode, boost);
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
