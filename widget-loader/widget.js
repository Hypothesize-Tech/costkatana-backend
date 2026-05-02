/**
 * CostKatana agent widget loader.
 *
 * Embed snippet (one tag, end-of-body):
 *
 *   <script src="https://cdn.costkatana.ai/widget.js"
 *           data-deployment-id="dep_xxxxxxxx"
 *           defer></script>
 *
 * Optional data-* attributes:
 *   data-app-base       - override the iframe origin (default: app.costkatana.ai)
 *   data-position       - "bottom-right" | "bottom-left" (default: bottom-right)
 *   data-launcher-color - hex, defaults to #06ec9e (CostKatana primary)
 *   data-launcher-label - label inside the launcher button (default: Chat)
 *
 * Postmessage protocol from iframe:
 *   { type: "costkatana-widget:close",  deploymentId }
 *   { type: "costkatana-widget:resize", deploymentId, height: number }
 */
(function () {
  'use strict';
  if (window.__COSTKATANA_WIDGET_LOADED__) return;
  window.__COSTKATANA_WIDGET_LOADED__ = true;

  var script = document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if ((scripts[i].src || '').indexOf('widget.js') !== -1) {
        script = scripts[i];
        break;
      }
    }
  }
  if (!script) return;

  var deploymentId = script.getAttribute('data-deployment-id');
  if (!deploymentId) {
    console.warn('[costkatana] data-deployment-id is required on the widget script tag.');
    return;
  }

  var appBase = script.getAttribute('data-app-base') || 'https://app.costkatana.ai';
  var position = script.getAttribute('data-position') || 'bottom-right';
  var launcherColor = script.getAttribute('data-launcher-color') || '#06ec9e';
  var launcherLabel = script.getAttribute('data-launcher-label') || 'Chat';

  var leftSide = position === 'bottom-left';

  // ── iframe ──
  var iframe = document.createElement('iframe');
  iframe.title = 'Chat assistant';
  iframe.allow = 'clipboard-write';
  iframe.src = appBase + '/embed/' + encodeURIComponent(deploymentId);
  Object.assign(iframe.style, {
    position: 'fixed',
    bottom: '88px',
    left: leftSide ? '20px' : 'auto',
    right: leftSide ? 'auto' : '20px',
    width: '380px',
    maxWidth: 'calc(100vw - 24px)',
    height: '560px',
    maxHeight: 'calc(100vh - 120px)',
    border: '0',
    borderRadius: '16px',
    boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
    background: '#ffffff',
    zIndex: '2147483646',
    display: 'none',
    transition: 'transform 200ms ease, opacity 200ms ease',
    opacity: '0',
    transform: 'translateY(12px) scale(0.98)',
  });

  // ── launcher button (built via DOM, not innerHTML) ──
  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', launcherLabel);
  Object.assign(launcher.style, {
    position: 'fixed',
    bottom: '20px',
    left: leftSide ? '20px' : 'auto',
    right: leftSide ? 'auto' : '20px',
    background: launcherColor,
    color: '#ffffff',
    border: '0',
    borderRadius: '999px',
    padding: '12px 18px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Inter", "Manrope", system-ui, sans-serif',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 12px 28px rgba(6, 236, 158, 0.32)',
    zIndex: '2147483647',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'transform 150ms ease, box-shadow 150ms ease',
  });

  // SVG icon (no innerHTML — built via createElementNS)
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
  svg.appendChild(path);

  var labelSpan = document.createElement('span');
  labelSpan.textContent = launcherLabel;

  launcher.appendChild(svg);
  launcher.appendChild(labelSpan);

  launcher.addEventListener('mouseenter', function () {
    launcher.style.transform = 'translateY(-1px)';
    launcher.style.boxShadow = '0 16px 36px rgba(6, 236, 158, 0.45)';
  });
  launcher.addEventListener('mouseleave', function () {
    launcher.style.transform = '';
    launcher.style.boxShadow = '0 12px 28px rgba(6, 236, 158, 0.32)';
  });

  var open = false;
  function setOpen(next) {
    open = next;
    if (open) {
      iframe.style.display = 'block';
      requestAnimationFrame(function () {
        iframe.style.opacity = '1';
        iframe.style.transform = 'translateY(0) scale(1)';
      });
      launcher.style.opacity = '0.6';
    } else {
      iframe.style.opacity = '0';
      iframe.style.transform = 'translateY(12px) scale(0.98)';
      launcher.style.opacity = '1';
      setTimeout(function () {
        if (!open) iframe.style.display = 'none';
      }, 200);
    }
  }

  launcher.addEventListener('click', function () {
    setOpen(!open);
  });

  // postMessage handlers — only trust messages from the configured app origin
  window.addEventListener('message', function (event) {
    var origin = (event.origin || '').replace(/\/$/, '');
    if (origin !== appBase.replace(/\/$/, '')) return;
    var data = event.data;
    if (!data || data.deploymentId !== deploymentId) return;
    if (data.type === 'costkatana-widget:close') setOpen(false);
    if (data.type === 'costkatana-widget:resize' && typeof data.height === 'number') {
      iframe.style.height = Math.max(360, Math.min(800, data.height)) + 'px';
    }
  });

  function mount() {
    document.body.appendChild(iframe);
    document.body.appendChild(launcher);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
