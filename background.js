/**
 * HTML 注入器 - 后台服务工作者
 * 负责扩展启动时检查更新
 * 通过 GitHub Releases API 对比版本号，有新版本时弹出通知
 */

// 当前扩展版本
var CURRENT_VERSION = "1.0.1";

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
        // 发送通知
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "HTML 注入器 - 发现新版本",
          message: "新版本 v" + latestVersion + " 已发布，请前往 GitHub 下载更新。",
          priority: 2,
        });

        // 存储最新版本信息供弹窗使用
        chrome.storage.local.set({
          updateAvailable: true,
          latestVersion: latestVersion,
          releaseUrl: data.html_url,
        });
      }
    })
    .catch(function () {
      // 网络错误，静默处理
    });
}

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
