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

  // 当前扩展版本（与 manifest.json 保持一致）
  var CURRENT_VERSION = "1.0.1";

  // 自动保存的防抖计时器
  var saveTimer = null;

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

    chrome.storage.local.set(
      {
        enabled: enabled,
        htmlCode: code,
        injectTiming: timing,
      },
      function () {
        showSaveStatus("已自动保存");
      }
    );
  }

  /**
   * 防抖保存：输入时延迟保存
   */
  function debouncedSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveConfig, 500);
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
      ["enabled", "htmlCode", "injectTiming"],
      function (result) {
        enabledToggle.checked = result.enabled || false;
        htmlCodeTextarea.value = result.htmlCode || "";
        var timing = result.injectTiming || "immediate";
        for (var i = 0; i < timingRadios.length; i++) {
          if (timingRadios[i].value === timing) {
            timingRadios[i].checked = true;
            break;
          }
        }
        updateSwitchLabel();
      }
    );
  }

  /**
   * 检查更新
   * 从 GitHub Releases API 获取最新版本号
   */
  function checkUpdate() {
    var repoUrl = "https://api.github.com/repos/diaoyunxi/html-injector/releases/latest";
    fetch(repoUrl)
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (data) {
        if (!data || !data.tag_name) return;
        var latestVersion = data.tag_name.replace(/^v/, "");
        if (latestVersion !== CURRENT_VERSION) {
          // 显示更新提示
          updateNotice.style.display = "block";
          if (data.html_url) {
            updateLink.href = data.html_url;
          }
        }
      })
      .catch(function () {
        // 网络错误，静默处理
      });
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

  saveBtn.addEventListener("click", function () {
    saveConfig();
    showSaveStatus("已保存");
  });

  // 初始化
  loadConfig();
  checkUpdate();

  // 显示当前版本
  versionEl.textContent = "v" + CURRENT_VERSION;
})();
