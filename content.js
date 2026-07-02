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
       * 关键：通过 innerHTML/DOMParser 插入的 <script> 标签不会执行，
       * 必须使用 document.createElement('script') 显式创建才能触发加载和执行
       * @param {HTMLHeadElement} headEl - head 元素
       * @param {string} code - HTML 代码
       */
      function injectIntoHead(headEl, code) {
        // 用临时容器解析 HTML
        var temp = document.createElement("div");
        temp.innerHTML = code;

        // 遍历所有子节点逐个插入
        while (temp.firstChild) {
          var node = temp.firstChild;

          if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "SCRIPT") {
            // script 标签必须用 createElement 重新创建才会执行
            var script = document.createElement("script");

            // 复制所有属性（src、type、async、defer 等）
            for (var i = 0; i < node.attributes.length; i++) {
              var attr = node.attributes[i];
              script.setAttribute(attr.name, attr.value);
            }

            // 如果有内联代码，设置 textContent
            if (node.textContent) {
              script.textContent = node.textContent;
            }

            headEl.appendChild(script);
            temp.removeChild(node);
          } else {
            // 非 script 元素直接移动到 head
            headEl.appendChild(node);
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
