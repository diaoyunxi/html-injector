/**
 * HTML 注入器 - 弹窗逻辑
 * 管理开关状态、HTML 代码、注入时机的读取与保存
 * 自动保存，并提供手动保存按钮
 */

(function () {
  "use strict";

  // DOM 元素引用
  var enabledToggle = document.getElementById("enabledToggle");
  var switchLabel = document.getElementById("switchLabel");
  var htmlCodeTextarea = document.getElementById("htmlCode");
  var saveStatus = document.getElementById("saveStatus");
  var saveBtn = document.getElementById("saveBtn");
  var versionEl = document.getElementById("version");
  var updateNotice = document.getElementById("updateNotice");
  var updateLink = document.getElementById("updateLink");
  var timingRadios = document.getElementsByName("timing");
  var zindexBoostCheckbox = document.getElementById("zindexBoost");
  var domainRulesTextarea = document.getElementById("domainRules");
  var exportBtn = document.getElementById("exportBtn");
  var importBtn = document.getElementById("importBtn");
  var importFile = document.getElementById("importFile");

  // DOM 元素空值防御：如果关键元素不存在，提前终止
  if (!enabledToggle || !switchLabel || !htmlCodeTextarea || !saveStatus ||
      !saveBtn || !versionEl || !updateNotice || !updateLink ||
      !timingRadios || !zindexBoostCheckbox) {
    console.error("[HTML注入器] DOM 元素缺失，弹窗初始化失败");
    return;
  }
  // domainRules 为可选功能，缺失时降级处理
  if (!domainRulesTextarea) {
    console.warn("[HTML注入器] domainRules 元素缺失，域名规则功能将不可用");
  }

  // 从 manifest.json 统一获取版本号
  var CURRENT_VERSION = "0.0.0"; // 占位，实际在初始化时赋值
  try {
    var manifest = chrome.runtime.getManifest();
    if (manifest && manifest.version) {
      CURRENT_VERSION = manifest.version;
    }
  } catch (e) {
    console.error("[HTML注入器] 读取 manifest 失败:", e && e.message);
  }

  // GitHub API 地址（统一常量）
  // 注意：此处与 background.js 中的 GITHUB_REPO 存在重复定义。
  // 原因：popup 需要独立发起更新检查请求，不能依赖 background service worker 的上下文
  // （service worker 可能处于休眠状态）。两处定义必须保持同步，修改时请一并更新。
  var GITHUB_REPO = "https://api.github.com/repos/diaoyunxi/html-injector";
  var RELEASES_API = GITHUB_REPO + "/releases/latest";

  // 自动保存的防抖计时器
  var saveTimer = null;

  /**
   * 比较版本号（与 background.js 保持一致）
   * @param {string} current - 当前版本号
   * @param {string} latest - 远程版本号
   * @returns {boolean} 如果 latest 比 current 更新则返回 true
   */
  function isNewerVersion(current, latest) {
    var versionRegex = /^\d+(\.\d+)*$/;
    if (!versionRegex.test(current) || !versionRegex.test(latest)) {
      return false;
    }
    var cp = current.split(".").map(Number);
    var lp = latest.split(".").map(Number);
    var max = Math.max(cp.length, lp.length);
    for (var i = 0; i < max; i++) {
      var c = cp[i] || 0, l = lp[i] || 0;
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
   * 显示保存状态提示
   * @param {string} text - 提示文本
   */
  function showSaveStatus(text) {
    saveStatus.textContent = text;
    saveStatus.classList.add("show");
    setTimeout(function () {
      saveStatus.classList.remove("show");
    }, 2000);
  }

  /**
   * 保存配置到 chrome.storage.local
   */
  function saveConfig() {
    var enabled = enabledToggle.checked;
    var code = htmlCodeTextarea.value;
    var timing = "immediate";
    for (var i = 0; i < timingRadios.length; i++) {
      if (timingRadios[i].checked) {
        timing = timingRadios[i].value;
        break;
      }
    }

    var config = {
      enabled: enabled,
      htmlCode: code,
      injectTiming: timing,
      zindexBoost: zindexBoostCheckbox.checked,
    };

    // 域名规则为可选功能，元素存在时才保存
    if (domainRulesTextarea) {
      config.domainRules = domainRulesTextarea.value;
    }

    chrome.storage.local.set(
      config,
      function () {
        if (chrome.runtime.lastError) {
          console.error("[HTML注入器] 保存配置失败:", chrome.runtime.lastError.message);
          showSaveStatus("保存失败");
          return;
        }
        showSaveStatus("已自动保存");
      }
    );
  }

  /**
   * 防抖保存：输入时延迟保存（缩短至 300ms，减少快速关闭 popup 时的丢失风险）
   */
  function debouncedSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveConfig, 300);
  }

  /**
   * 更新开关标签文字
   */
  function updateSwitchLabel() {
    switchLabel.textContent = enabledToggle.checked ? "已开启" : "已关闭";
  }

  /**
   * 从 chrome.storage.local 读取配置并填充 UI
   */
  function loadConfig() {
    chrome.storage.local.get(
      ["enabled", "htmlCode", "injectTiming", "zindexBoost", "domainRules"],
      function (result) {
        if (chrome.runtime.lastError) {
          console.error("[HTML注入器] 读取配置失败:", chrome.runtime.lastError.message);
          return;
        }
        enabledToggle.checked = result.enabled || false;
        htmlCodeTextarea.value = result.htmlCode || "";
        var timing = result.injectTiming || "immediate";
        for (var i = 0; i < timingRadios.length; i++) {
          if (timingRadios[i].value === timing) {
            timingRadios[i].checked = true;
            break;
          }
        }
        // zindexBoost 默认为 true
        zindexBoostCheckbox.checked = result.zindexBoost !== false;
        // 域名规则为可选功能
        if (domainRulesTextarea) {
          domainRulesTextarea.value = result.domainRules || "";
        }
        updateSwitchLabel();
      }
    );
  }

  /**
   * 检查更新
   * 从 GitHub Releases API 获取最新版本号，使用 isNewerVersion 比较
   */
  function checkUpdate() {
    fetchWithTimeout(RELEASES_API, 8000)
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (data) {
        if (!data || !data.tag_name) return;
        var latestVersion = data.tag_name.replace(/^v/, "");
        // 使用 isNewerVersion 判断，而非简单的 !== 比较
        if (isNewerVersion(CURRENT_VERSION, latestVersion)) {
          updateNotice.style.display = "block";
          // 校验 html_url 的合法性，防止恶意 URL
          if (data.html_url && /^https:\/\/github\.com\//.test(data.html_url)) {
            updateLink.href = data.html_url;
          }
        }
      })
      .catch(function (err) {
        console.error("[HTML注入器] 检查更新失败:", err && err.message);
      });
  }

  /**
   * 导出配置为 JSON 文件
   * 将当前所有配置项打包为 JSON 格式，触发浏览器下载
   */
  function exportConfig() {
    chrome.storage.local.get(
      ["enabled", "htmlCode", "injectTiming", "zindexBoost", "domainRules"],
      function (result) {
        if (chrome.runtime.lastError) {
          console.error("[HTML注入器] 读取配置用于导出失败:", chrome.runtime.lastError.message);
          showSaveStatus("导出失败");
          return;
        }
        // 构建导出数据，附带版本号便于后续兼容性处理
        var exportData = {
          _format: "html-injector-config",
          _version: CURRENT_VERSION,
          _exportTime: new Date().toISOString(),
          enabled: result.enabled || false,
          htmlCode: result.htmlCode || "",
          injectTiming: result.injectTiming || "immediate",
          zindexBoost: result.zindexBoost !== false,
          domainRules: result.domainRules || "",
        };
        var jsonStr = JSON.stringify(exportData, null, 2);
        var blob = new Blob([jsonStr], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "html-injector-config.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSaveStatus("配置已导出");
      }
    );
  }

  /**
   * 导入配置从 JSON 文件
   * 读取用户选择的 JSON 文件，校验格式后写入 chrome.storage.local
   * @param {File} file - 用户选择的文件对象
   */
  function importConfig(file) {
    if (!file) {
      console.warn("[HTML注入器] 未选择文件");
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        // 校验导入数据的合法性
        if (typeof data !== "object" || data === null) {
          throw new Error("配置文件格式不正确：非有效 JSON 对象");
        }
        // 构建待保存的配置（只导入已知字段，忽略未知字段）
        var config = {};
        if (typeof data.enabled === "boolean") config.enabled = data.enabled;
        if (typeof data.htmlCode === "string") config.htmlCode = data.htmlCode;
        if (typeof data.injectTiming === "string") config.injectTiming = data.injectTiming;
        if (typeof data.zindexBoost === "boolean") config.zindexBoost = data.zindexBoost;
        if (typeof data.domainRules === "string") config.domainRules = data.domainRules;

        chrome.storage.local.set(config, function () {
          if (chrome.runtime.lastError) {
            console.error("[HTML注入器] 导入配置写入失败:", chrome.runtime.lastError.message);
            showSaveStatus("导入失败");
            return;
          }
          // 重新加载 UI 以反映导入的配置
          loadConfig();
          showSaveStatus("配置已导入");
        });
      } catch (err) {
        console.error("[HTML注入器] 解析配置文件失败:", err && err.message);
        showSaveStatus("导入失败：文件格式错误");
      }
    };
    reader.onerror = function () {
      console.error("[HTML注入器] 读取文件失败");
      showSaveStatus("导入失败：读取文件错误");
    };
    reader.readAsText(file);
  }

  // 事件监听
  enabledToggle.addEventListener("change", function () {
    updateSwitchLabel();
    saveConfig();
  });

  htmlCodeTextarea.addEventListener("input", debouncedSave);

  for (var i = 0; i < timingRadios.length; i++) {
    timingRadios[i].addEventListener("change", saveConfig);
  }

  zindexBoostCheckbox.addEventListener("change", saveConfig);

  // 域名规则输入：自动保存
  if (domainRulesTextarea) {
    domainRulesTextarea.addEventListener("input", debouncedSave);
  }

  // 导出配置按钮
  if (exportBtn) {
    exportBtn.addEventListener("click", exportConfig);
  }

  // 导入配置按钮：触发隐藏的文件选择框
  if (importBtn) {
    importBtn.addEventListener("click", function () {
      if (importFile) {
        importFile.click();
      }
    });
  }

  // 文件选择变化：读取并导入配置
  if (importFile) {
    importFile.addEventListener("change", function () {
      if (importFile.files && importFile.files[0]) {
        importConfig(importFile.files[0]);
        // 重置 input 以便重复导入同一文件
        importFile.value = "";
      }
    });
  }

  saveBtn.addEventListener("click", function () {
    saveConfig();
    showSaveStatus("已保存");
  });

  // popup 关闭前同步保存，防止快速关闭导致最后一次输入丢失
  window.addEventListener("beforeunload", function () {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      saveConfig();
    }
  });

  // 初始化
  loadConfig();
  checkUpdate();

  // 显示当前版本
  versionEl.textContent = "v" + CURRENT_VERSION;
})();
