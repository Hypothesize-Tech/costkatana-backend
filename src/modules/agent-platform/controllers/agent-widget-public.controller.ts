import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  SetMetadata,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';

import { AgentDeploymentService } from '../services/agent-deployment.service';
import { WidgetSessionService } from '../services/widget-session.service';
import {
  AgentRunnerService,
  AGENT_RUN_EVENT_PREFIX,
} from '../services/agent-runner.service';
import {
  WidgetSessionGuard,
  WIDGET_SESSION_PUBLIC,
} from '../guards/widget-session.guard';

const RUN_EVENT_SUFFIXES = [
  'step.start',
  'step.end',
  'paused',
  'run.end',
  'run.error',
];

const WidgetSessionPublic = () => SetMetadata(WIDGET_SESSION_PUBLIC, true);

interface WidgetSessionContext {
  sessionId: string;
  deploymentId: string;
  originHash: string;
}

@Controller('api/public/widget')
@UseGuards(WidgetSessionGuard)
export class AgentWidgetPublicController {
  constructor(
    private readonly deployments: AgentDeploymentService,
    private readonly widgetSessions: WidgetSessionService,
    private readonly runner: AgentRunnerService,
    private readonly events: EventEmitter2,
  ) {}

  @Post(':publicId/session')
  @WidgetSessionPublic()
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Param('publicId') publicId: string,
    @Headers('origin') origin?: string,
  ) {
    const deployment = await this.deployments.findByPublicId(publicId);
    if (!deployment) throw new NotFoundException('Deployment not found');
    if (deployment.status !== 'active') {
      throw new BadRequestException('Deployment is paused');
    }
    this.deployments.assertOriginAllowed(deployment, origin);
    const session = this.widgetSessions.issueSession(
      String(deployment._id),
      origin ?? '',
    );
    return {
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      theme: deployment.theme,
      welcomeMessage: deployment.welcomeMessage,
    };
  }

  @Post('message')
  @HttpCode(HttpStatus.ACCEPTED)
  async postMessage(
    @Req() req: Request & { widgetSession?: WidgetSessionContext },
    @Body() body: { message: unknown; metadata?: Record<string, unknown> },
  ) {
    const session = req.widgetSession;
    if (!session) throw new BadRequestException('Missing widget session');

    const dep = await this.deployments.findById(session.deploymentId);
    if (!dep) {
      throw new NotFoundException('Deployment not found');
    }

    if (dep.status !== 'active') {
      throw new BadRequestException('Deployment is paused');
    }

    const result = await this.runner.startRun({
      agentDefinitionId: String(dep.agentDefinitionId),
      agentVersionId: String(dep.agentVersionId),
      organizationId: String(dep.organizationId),
      deploymentId: String(dep._id),
      widgetSessionId: session.sessionId,
      mode: 'live',
      input: body.message,
    });

    return {
      runId: result.runId,
      streamUrl: `/api/public/widget/runs/${result.runId}/stream`,
    };
  }

  @Get('bundle.js')
  @WidgetSessionPublic()
  serveBundle(@Res() res: Response): void {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(WIDGET_JS_BUNDLE);
  }

  @Get('runs/:runId/stream')
  @WidgetSessionPublic()
  @Sse()
  streamRun(@Param('runId') runId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const handlers: Array<{ event: string; fn: (...a: unknown[]) => void }> =
        [];
      let closed = false;

      for (const suffix of RUN_EVENT_SUFFIXES) {
        const event = `${AGENT_RUN_EVENT_PREFIX}.${runId}.${suffix}`;
        const fn = (payload: unknown) => {
          if (closed) return;
          // Public stream redacts cost/tokens.
          const data = redact(payload);
          subscriber.next({ type: suffix, data } as MessageEvent);
          if (suffix === 'run.end' || suffix === 'run.error') {
            closed = true;
            subscriber.complete();
          }
        };
        this.events.on(event, fn);
        handlers.push({ event, fn });
      }

      return () => {
        closed = true;
        for (const { event, fn } of handlers) this.events.off(event, fn);
      };
    });
  }
}

function redact(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const copy: Record<string, unknown> = {
    ...(payload as Record<string, unknown>),
  };
  delete copy.tokens;
  delete copy.costUsd;
  return copy;
}

/* ---------- Embed widget JS served at GET /api/public/widget/bundle.js ---------- */
const WIDGET_JS_BUNDLE = `(function () {
  'use strict';
  var SCRIPT = document.currentScript || (function () {
    var all = document.querySelectorAll('script[data-deployment-id]');
    return all[all.length - 1];
  })();
  var DEPLOY = SCRIPT ? SCRIPT.getAttribute('data-deployment-id') : null;
  var BASE   = (SCRIPT ? (SCRIPT.getAttribute('data-api-url') || '') : '').replace(/\\/$/,'');
  if (!BASE && SCRIPT && SCRIPT.src) {
    try { BASE = new URL(SCRIPT.src).origin; } catch (e) {}
  }
  if (!DEPLOY || DEPLOY === '<deployment-id>') {
    console.warn('[CostKatana] Widget: missing data-deployment-id');
    return;
  }

  var S = { token: null, open: false, busy: false,
            theme: { primary: '#06ec9e', surface: '#ffffff', position: 'bottom-right' },
            welcome: 'Hi — how can I help today?' };
  var E = {};
  var SVG = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'on') Object.keys(attrs[k]).forEach(function (ev) { e.addEventListener(ev, attrs[k][ev]); });
      else e.setAttribute(k, attrs[k]);
    });
    if (kids) [].concat(kids).forEach(function (c) {
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function makeSvg(size, children) {
    var s = svgEl('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    children.forEach(function (c) { s.appendChild(c); });
    return s;
  }

  function iconChat() {
    return makeSvg(22, [
      svgEl('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }),
    ]);
  }
  function iconSend() {
    return makeSvg(16, [
      svgEl('line',    { x1: '22', y1: '2',  x2: '11', y2: '13' }),
      svgEl('polygon', { points: '22 2 15 22 11 13 2 9 22 2' }),
    ]);
  }
  function iconClose() {
    return makeSvg(18, [
      svgEl('line', { x1: '18', y1: '6',  x2: '6',  y2: '18' }),
      svgEl('line', { x1: '6',  y1: '6',  x2: '18', y2: '18' }),
    ]);
  }

  function initSession() {
    fetch(BASE + '/api/public/widget/' + DEPLOY + '/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      S.token = d.sessionToken;
      if (d.theme)          S.theme   = Object.assign({}, S.theme, d.theme);
      if (d.welcomeMessage) S.welcome = d.welcomeMessage;
      mount();
    })
    .catch(function (e) { console.error('[CostKatana] Widget init:', e); });
  }

  function mount() {
    var p    = S.theme.primary;
    var surf = S.theme.surface;
    var left = S.theme.position === 'bottom-left';
    var side = left ? 'left:20px' : 'right:20px';
    var orig = left ? 'bottom left' : 'bottom right';

    var css = [
      '#ck-b,#ck-p{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-sizing:border-box}',
      '#ck-b *,#ck-p *{box-sizing:border-box}',
      '#ck-b{position:fixed;bottom:20px;' + side + ';z-index:2147483646;width:54px;height:54px;border-radius:50%;',
        'background:' + p + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;',
        'box-shadow:0 4px 20px rgba(0,0,0,.22);transition:transform .15s;color:#0f172a}',
      '#ck-b:hover{transform:scale(1.08)}',
      '#ck-p{position:fixed;bottom:86px;' + side + ';width:340px;max-width:calc(100vw - 24px);height:480px;',
        'max-height:calc(100vh - 106px);display:flex;flex-direction:column;border-radius:16px;overflow:hidden;',
        'box-shadow:0 10px 44px rgba(0,0,0,.18);z-index:2147483645;background:' + surf + ';',
        'transition:opacity .18s,transform .18s;transform-origin:' + orig + '}',
      '#ck-p.ck-off{opacity:0;transform:scale(.94) translateY(8px);pointer-events:none}',
      '#ck-hd{background:linear-gradient(135deg,' + p + '28,' + p + '08);border-bottom:1px solid rgba(0,0,0,.07);',
        'padding:12px 16px;display:flex;align-items:center;gap:10px}',
      '#ck-hd .d{width:8px;height:8px;border-radius:50%;background:' + p + ';box-shadow:0 0 8px ' + p + '}',
      '#ck-hd .t{font-size:13px;font-weight:600;flex:1;color:#0f172a}',
      '#ck-hd .x{background:none;border:none;cursor:pointer;color:#94a3b8;padding:0;display:flex;line-height:1}',
      '#ck-hd .x:hover{color:#475569}',
      '#ck-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}',
      '.ck-m{max-width:84%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.55;word-wrap:break-word;white-space:pre-wrap}',
      '.ck-m.bot{background:#f1f5f9;color:#1e293b;align-self:flex-start;border-bottom-left-radius:3px}',
      '.ck-m.usr{background:' + p + ';color:#0f172a;align-self:flex-end;border-bottom-right-radius:3px;font-weight:500}',
      '.ck-m.typ{color:#94a3b8;font-style:italic}',
      '#ck-row{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid rgba(0,0,0,.07)}',
      '#ck-inp{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:13px;',
        'outline:none;background:#f8fafc;color:#0f172a;resize:none;min-height:38px;max-height:100px;font-family:inherit}',
      '#ck-inp:focus{border-color:' + p + ';background:#fff}',
      '#ck-snd{width:36px;height:36px;border-radius:8px;background:' + p + ';border:none;cursor:pointer;',
        'display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#0f172a;transition:opacity .15s}',
      '#ck-snd:disabled{opacity:.45;cursor:not-allowed}',
    ].join('');

    var styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    E.msgs = el('div', { id: 'ck-msgs' });
    E.inp  = el('textarea', { id: 'ck-inp', placeholder: 'Type a message…', rows: '1',
      on: {
        keydown: function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); } },
        input:   function ()   { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px'; },
      },
    });
    E.snd = el('button', { id: 'ck-snd', 'aria-label': 'Send', on: { click: send } }, [iconSend()]);

    E.panel = el('div', { id: 'ck-p', class: 'ck-off' }, [
      el('div', { id: 'ck-hd' }, [
        el('span', { class: 'd' }),
        el('span', { class: 't' }, 'Chat'),
        el('button', { class: 'x', 'aria-label': 'Close chat', on: { click: toggle } }, [iconClose()]),
      ]),
      E.msgs,
      el('div', { id: 'ck-row' }, [E.inp, E.snd]),
    ]);

    E.bubble = el('button', { id: 'ck-b', 'aria-label': 'Open chat', on: { click: toggle } }, [iconChat()]);

    document.body.appendChild(E.panel);
    document.body.appendChild(E.bubble);
    addMsg('bot', S.welcome);
  }

  function toggle() {
    S.open = !S.open;
    E.panel.classList.toggle('ck-off', !S.open);
    if (S.open) setTimeout(function () { E.inp.focus(); }, 80);
  }

  function addMsg(role, text) {
    var m = el('div', { class: 'ck-m ' + role });
    m.textContent = text;
    E.msgs.appendChild(m);
    E.msgs.scrollTop = E.msgs.scrollHeight;
    return m;
  }

  function send() {
    if (S.busy) return;
    var txt = (E.inp.value || '').trim();
    if (!txt) return;
    E.inp.value = ''; E.inp.style.height = 'auto';
    addMsg('usr', txt);
    var typEl = addMsg('bot', '…'); typEl.classList.add('typ');
    S.busy = true; E.snd.disabled = true; E.inp.disabled = true;

    fetch(BASE + '/api/public/widget/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.token },
      body: JSON.stringify({ message: txt }),
    })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (!d.runId) throw new Error('no runId'); openStream(d.runId, typEl); })
    .catch(function () { typEl.textContent = 'Request failed — please try again.'; typEl.classList.remove('typ'); idle(); });
  }

  function openStream(runId, typEl) {
    var es = new EventSource(BASE + '/api/public/widget/runs/' + runId + '/stream');
    var buf = '';

    es.addEventListener('step.end', function (ev) {
      try {
        var d = JSON.parse(ev.data);
        if (d && d.output && typeof d.output.text === 'string') {
          buf += d.output.text;
          typEl.textContent = buf; typEl.classList.remove('typ');
          E.msgs.scrollTop = E.msgs.scrollHeight;
        }
      } catch (_) {}
    });

    es.addEventListener('run.end', function (ev) {
      try {
        var d = JSON.parse(ev.data);
        if (!buf && d && d.output && typeof d.output.text === 'string') {
          buf = d.output.text; typEl.textContent = buf; typEl.classList.remove('typ');
        }
      } catch (_) {}
      if (!buf) { typEl.textContent = '(no response)'; typEl.classList.remove('typ'); }
      E.msgs.scrollTop = E.msgs.scrollHeight;
      es.close(); idle();
    });

    es.addEventListener('run.error', function () {
      typEl.textContent = 'Something went wrong. Please try again.'; typEl.classList.remove('typ');
      E.msgs.scrollTop = E.msgs.scrollHeight;
      es.close(); idle();
    });

    es.onerror = function () {
      if (!buf) { typEl.textContent = 'Connection lost.'; typEl.classList.remove('typ'); }
      es.close(); idle();
    };
  }

  function idle() {
    S.busy = false; E.snd.disabled = false; E.inp.disabled = false;
    setTimeout(function () { E.inp.focus(); }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSession);
  } else {
    initSession();
  }
})();`;
