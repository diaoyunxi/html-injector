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

// GitHub 仓库 API 地址（统一常量）。
// 注意：popup.js 中存在同名常量定义（popup 需独立发起更新检查请求，
// 避免依赖 background 上下文）。两处必须保持同步；如需修改请同步更新 popup.js。
var GITHUB_REPO = "https://api.github.com/repos/diaoyunxi/html-injector";
var RELEASES_API = GITHUB_REPO + "/releases/latest";

// 从 manifest.json 统一获取版本号
var CURRENT_VERSION = "0.0.0"; // 占位，实际在 initConfig 中赋值

// 内存配置缓存，避免每次 tabs.onUpdated 都读取 storage
var cachedConfig = {
  enabled: false,
  htmlCode: "",
  injectTiming: "immediate",
  zindexBoost: true,
  domainRules: "", // 域名规则：仅匹配的域名才注入，留空表示注入所有域名
};

// MutationObserver 定时器引用，用于清理
var observerTimerId = null;

/**
 * 比较版本号（支持语义化版本格式 x.y.z）
 * @param {string} current - 当前版本号
 * @param {string} latest - 远程版本号
 * @returns {boolean} 如果 latest 比 current 更新则返回 true
 */
function isNewerVersion(current, latest) {
  // 校验版本号格式：必须是纯数字版本号，如 "1.0.3"、"2.1"
  var versionRegex = /^\d+(\.\d+)*$/;
  if (!versionRegex.test(current) || !versionRegex.test(latest)) {
    console.warn("[HTML注入器] 版本号格式非法，current=" + current + ", latest=" + latest);
    return false;
  }

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
 * 带超时的 fetch 封装
 * @param {string} url - 请求地址
 * @param {number} [timeout=8000] - 超时时间（毫秒）
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, timeout) {
  timeout = timeout || 8000;
  var controller = new AbortController();
  var timeoutId = setTimeout(function () {
    controller.abort();
  }, timeout);
  return fetch(url, { signal: controller.signal }).then(function (resp) {
    clearTimeout(timeoutId);
    return resp;
  }).catch(function (err) {
    clearTimeout(timeoutId);
    throw err;
  });
}

/**
 * 检查更新（使用带超时的 fetch）
 */
function checkForUpdate() {
  fetchWithTimeout(RELEASES_API, 8000)
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
    .catch(function (err) {
      console.error("[HTML注入器] 检查更新失败:", err && err.message);
    });
}

// ============ 注入逻辑拆分的子函数（在主世界中执行） ============

/**
 * 注入置顶显示的 CSS 规则
 * @param {Element} target - 注入目标（head 或 documentElement）
 */
function injectZindexCSS(target) {
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
}

/**
 * 判断元素是否为 widget 类元素
 * 提升到外部作用域，避免在 MutationObserver 回调中重复定义
 * @param {Element} el - DOM 元素
 * @returns {boolean}
 */
function isWidgetLike(el) {
  var id = (el.id || "").toLowerCase();
  var cls = (el.className || "").toString().toLowerCase();
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
    var style = el.style;
    // 快速预筛：先检查内联 style，避免触发 getComputedStyle 重排
    if (style.position === "fixed" || style.position === "absolute") {
      if (el.querySelector("canvas")) return true;
    } else {
      // 内联样式未设置时才回退到 getComputedStyle
      var computed = window.getComputedStyle(el);
      if ((computed.position === "fixed" || computed.position === "absolute") &&
          el.querySelector("canvas")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 为元素及其子孙节点提升 z-index
 * @param {Element} node - 起始节点
 */
function boostNodeZindex(node) {
  if (isWidgetLike(node)) {
    node.style.setProperty("z-index", "2147483647", "important");
  }
  // 使用 TreeWalker 遍历子孙节点，避免 querySelectorAll 创建中间数组
  if (node.nodeType === 1) {
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (child) {
        var tag = child.tagName;
        if (tag === "DIV" || tag === "CANVAS" || tag === "IFRAME" || tag === "SPAN") {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()) {
      var child = walker.currentNode;
      if (isWidgetLike(child)) {
        child.style.setProperty("z-index", "2147483647", "important");
      }
    }
  }
}

/**
 * 启动 MutationObserver 监控动态创建的 widget 元素
 * @param {Element} target - 注入目标
 */
function observeWidgets(target) {
  var zObserver = new MutationObserver(function (mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var mutation = mutations[m];
      var addedNodes = mutation.addedNodes;
      for (var n = 0; n < addedNodes.length; n++) {
        var node = addedNodes[n];
        if (node.nodeType !== 1) continue;
        boostNodeZindex(node);
      }
    }
  });

  zObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // 30 秒后停止观察（部分 widget 初始化较慢，延长时间以确保捕获动态创建的元素）
  var timerId = setTimeout(function () {
    zObserver.disconnect();
  }, 30000);

  // 返回 timerId 以便外部需要时清理
  return timerId;
}

/**
 * 注入用户 HTML 代码中的脚本节点
 * script 标签必须用 createElement 重新创建才会执行
 * @param {Element} target - 注入目标
 * @param {Element} node - script 节点
 */
function injectScriptNode(target, node) {
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
}

/**
 * 注入用户的 HTML 代码到页面
 * @param {Element} target - 注入目标
 * @param {string} code - 用户输入的 HTML 代码
 */
function injectUserHtml(target, code) {
  // 危险代码检测（仅警告，不阻止注入——因为功能本身即为任意注入）。
  // 覆盖：javascript: 伪协议、data:text/html、事件处理属性（onXxx=）、
  // 以及 svg/iframe/object/embed 等可执行脚本或加载外部资源的危险标签变体。
  var dangerous = /javascript\s*:|data:text\/html|on\w+\s*=|<svg|<iframe|<object|<embed/gi;
  if (dangerous.test(code)) {
    console.warn("[HTML注入器] 检测到潜在危险代码（含事件属性或危险标签），请确认来源可信");
  }

  var temp = document.createElement("div");
  temp.innerHTML = code;

  while (temp.firstChild) {
    var node = temp.firstChild;
    if (node.nodeType === 1 && node.tagName === "SCRIPT") {
      injectScriptNode(target, node);
      temp.removeChild(node);
    } else {
      target.appendChild(node);
    }
  }
}

/**
 * 主注入函数（在页面主世界中执行）
 * @param {string} code - 用户输入的 HTML 代码
 * @param {boolean} boostZindex - 是否启用置顶显示
 */
function mainWorldInject(code, boostZindex) {
  // 防止重复注入
  if (window.__HTML_INJECTOR_DONE__) return;
  window.__HTML_INJECTOR_DONE__ = true;

  var target = document.head || document.documentElement;

  if (boostZindex) {
    injectZindexCSS(target);
    observeWidgets(target);
  }

  injectUserHtml(target, code);
}

/**
 * 清除页面中的防重复注入标记，使下次注入可生效
 * @param {number} tabId - 标签页 ID
 */
function clearInjectionMark(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: function () {
      window.__HTML_INJECTOR_DONE__ = false;
    },
  }).catch(function (err) {
    // 特殊页面（chrome:// 等）无法注入，检查已知关键词后静默忽略
    var msg = (err && err.message) || "";
    var ignorable = ["Cannot access", "Cannot inject"];
    for (var i = 0; i < ignorable.length; i++) {
      if (msg.indexOf(ignorable[i]) >= 0) return;
    }
    console.error("[HTML注入器] 清除注入标记失败:", msg);
  });
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
    target: { tabId: tabId, allFrames: false }, // 仅注入主框架，避免注入第三方 iframe
    world: "MAIN",
    func: mainWorldInject,
    args: [htmlCode, zindexBoost],
  }).catch(function (err) {
    // 特殊页面（chrome:// 等）无法注入，检查已知关键词后静默忽略
    var msg = (err && err.message) || "";
    var ignorable = ["Cannot access", "Cannot inject"];
    for (var i = 0; i < ignorable.length; i++) {
      if (msg.indexOf(ignorable[i]) >= 0) return;
    }
    console.error("[HTML注入器] 注入失败:", msg);
  });
}

/**
 * 初始化配置：从 manifest.json 读取版本号，预加载 storage 到内存缓存
 */
function initConfig() {
  // 从 manifest.json 统一获取版本号
  try {
    var manifest = chrome.runtime.getManifest();
    if (manifest && manifest.version) {
      CURRENT_VERSION = manifest.version;
    }
  } catch (e) {
    console.error("[HTML注入器] 读取 manifest 失败:", e && e.message);
  }

  // 预加载配置到内存缓存
  chrome.storage.local.get(
    ["enabled", "htmlCode", "injectTiming", "zindexBoost", "domainRules"],
    function (result) {
      if (chrome.runtime.lastError) {
        console.error("[HTML注入器] 初始化读取配置失败:", chrome.runtime.lastError.message);
        return;
      }
      cachedConfig.enabled = result.enabled || false;
      cachedConfig.htmlCode = result.htmlCode || "";
      cachedConfig.injectTiming = result.injectTiming || "immediate";
      cachedConfig.zindexBoost = result.zindexBoost !== false;
      cachedConfig.domainRules = result.domainRules || "";
    }
  );
}

/**
 * 域名匹配：检查页面 URL 的域名是否在规则列表中
 * 支持通配符匹配，如 *.example.com 匹配所有子域
 * @param {string} tabUrl - 标签页 URL
 * @param {string} domainRulesText - 域名规则文本（每行一条规则）
 * @returns {boolean} 规则为空时返回 true（注入所有域名）；否则仅匹配的域名返回 true
 */
function isDomainAllowed(tabUrl, domainRulesText) {
  // 规则为空时，注入所有域名
  if (!domainRulesText || !domainRulesText.trim()) {
    return true;
  }

  // 从 URL 中提取主机名
  var hostname = "";
  try {
    hostname = new URL(tabUrl).hostname;
  } catch (e) {
    console.warn("[HTML注入器] 无法解析 URL 主机名:", tabUrl);
    return false;
  }
  if (!hostname) return false;

  // 逐行解析规则，支持通配符
  var rules = domainRulesText.split("\n");
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i].trim();
    if (!rule) continue;

    // 移除可能的协议前缀
    rule = rule.replace(/^https?:\/\//, "");

    if (rule.indexOf("*.") === 0) {
      // 通配符规则：*.example.com 匹配 sub.example.com 和 example.com
      var baseDomain = rule.slice(2); // 去掉 *.
      if (hostname === baseDomain || hostname.endsWith("." + baseDomain)) {
        return true;
      }
    } else {
      // 精确匹配
      if (hostname === rule) {
        return true;
      }
    }
  }

  return false;
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

  // 直接使用内存缓存，避免每次事件都读取 storage
  var enabled = cachedConfig.enabled;
  var htmlCode = cachedConfig.htmlCode;
  var timing = cachedConfig.injectTiming;
  var boost = cachedConfig.zindexBoost;
  var domainRules = cachedConfig.domainRules;

  // 未启用或无代码则退出
  if (!enabled || !htmlCode) return;

  // 域名规则过滤：仅匹配的域名才注入
  if (!isDomainAllowed(tab.url, domainRules)) {
    return;
  }

  // 根据注入时机判断是否应该注入
  if (timing === "immediate") {
    if (changeInfo.status === "loading") {
      injectHtml(tabId, htmlCode, boost);
    }
  } else if (timing === "dom_ready") {
    if (changeInfo.status === "complete") {
      injectHtml(tabId, htmlCode, boost);
    }
  } else {
    // 非法 injectTiming 值，记录警告并使用默认值
    console.warn("[HTML注入器] 未知的 injectTiming 值: " + timing + "，使用默认值 immediate");
    cachedConfig.injectTiming = "immediate";
    if (changeInfo.status === "loading") {
      injectHtml(tabId, htmlCode, boost);
    }
  }
});

/**
 * 监听开关状态变化
 * 当用户打开开关或修改代码时，立即向当前活动标签页注入代码
 */
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== "local") return;

  // 同步更新内存缓存
  if (changes.enabled !== undefined) {
    cachedConfig.enabled = changes.enabled.newValue || false;
  }
  if (changes.htmlCode !== undefined) {
    cachedConfig.htmlCode = changes.htmlCode.newValue || "";
  }
  if (changes.injectTiming !== undefined) {
    cachedConfig.injectTiming = changes.injectTiming.newValue || "immediate";
  }
  if (changes.zindexBoost !== undefined) {
    cachedConfig.zindexBoost = changes.zindexBoost.newValue !== false;
  }
  if (changes.domainRules !== undefined) {
    cachedConfig.domainRules = changes.domainRules.newValue || "";
  }

  if (changes.enabled || changes.htmlCode || changes.zindexBoost || changes.domainRules) {
    // 代码或开关变更时，清除当前页面的防重复注入标记，使注入可重新生效
    if (changes.htmlCode) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) {
          console.error("[HTML注入器] query tabs 失败:", chrome.runtime.lastError.message);
          return;
        }
        if (tabs[0] && tabs[0].id) {
          clearInjectionMark(tabs[0].id);
        }
      });
    }

    if (cachedConfig.enabled && cachedConfig.htmlCode) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) {
          console.error("[HTML注入器] query tabs 失败:", chrome.runtime.lastError.message);
          return;
        }
        if (tabs[0] && tabs[0].url &&
            (tabs[0].url.startsWith("http://") || tabs[0].url.startsWith("https://")) &&
            isDomainAllowed(tabs[0].url, cachedConfig.domainRules)) {
          injectHtml(tabs[0].id, cachedConfig.htmlCode, cachedConfig.zindexBoost);
        }
      });
    }
  }
});

// 通知点击事件 - 打开发布页面（校验 URL 合法性）
chrome.notifications.onClicked.addListener(function (notificationId) {
  chrome.storage.local.get(["releaseUrl"], function (result) {
    if (chrome.runtime.lastError) {
      console.error("[HTML注入器] 读取 releaseUrl 失败:", chrome.runtime.lastError.message);
      return;
    }
    if (result.releaseUrl && result.releaseUrl.startsWith("https://github.com/")) {
      chrome.tabs.create({ url: result.releaseUrl });
    }
  });
  chrome.notifications.clear(notificationId);
});

// 扩展安装/启动时初始化配置并检查更新
chrome.runtime.onInstalled.addListener(function () {
  initConfig();
  checkForUpdate();
});
chrome.runtime.onStartup.addListener(function () {
  initConfig();
  checkForUpdate();
});
