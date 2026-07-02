/**
 * HTML 注入器 - 内容脚本
 * 在网页 head 中插入用户自定义的 HTML 代码
 * 支持两种注入时机：立即注入（head 可用时）和 DOM 就绪后注入
 */

(function () {
  "use strict";

  // 注入标记，防止重复注入
  var INJECT_FLAG = "__html_injector_done__";

  // 从 chrome.storage 读取配置并执行注入
  chrome.storage.local.get(
    ["enabled", "htmlCode", "injectTiming"],
    function (result) {
      var enabled = result.enabled || false;
      var htmlCode = result.htmlCode || "";
      var timing = result.injectTiming || "immediate";

      // 未启用或无代码则退出
      if (!enabled || !htmlCode) return;

      /**
       * 执行 HTML 注入
       * 将用户提供的 HTML 代码插入到 head 标签中
       */
      function doInject() {
        // 防止重复注入
        if (window[INJECT_FLAG]) return;
        window[INJECT_FLAG] = true;

        var head = document.head || document.querySelector("head");
        if (!head) {
          // head 尚未创建，使用 MutationObserver 等待
          var observer = new MutationObserver(function (mutations, obs) {
            if (document.head) {
              injectIntoHead(document.head, htmlCode);
              obs.disconnect();
            }
          });
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
          });
          // 5 秒后超时停止观察
          setTimeout(function () {
            observer.disconnect();
          }, 5000);
        } else {
          injectIntoHead(head, htmlCode);
        }
      }

      /**
       * 将 HTML 代码插入到指定的 head 元素中
       * @param {HTMLHeadElement} headEl - head 元素
       * @param {string} code - HTML 代码
       */
      function injectIntoHead(headEl, code) {
        try {
          // 使用 DOMParser 解析 HTML 代码
          var parser = new DOMParser();
          var doc = parser.parseFromString("<head>" + code + "</head>", "text/html");
          var nodes = doc.head.childNodes;
          // 逐个插入节点
          for (var i = 0; i < nodes.length; i++) {
            headEl.appendChild(nodes[i].cloneNode(true));
          }
        } catch (e) {
          // 如果 DOMParser 不可用，回退到 innerHTML 方式
          var temp = document.createElement("div");
          temp.innerHTML = code;
          while (temp.firstChild) {
            headEl.appendChild(temp.firstChild);
          }
        }
      }

      // 根据用户选择的时机执行注入
      if (timing === "immediate") {
        doInject();
      } else if (timing === "dom_ready") {
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", doInject);
        } else {
          doInject();
        }
      }
    }
  );
})();
