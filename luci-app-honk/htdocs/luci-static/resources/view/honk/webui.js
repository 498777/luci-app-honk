'use strict';
'require view';
'require fs';
'require uci';
'require ui';
'require dom';

/*
 * WebUI —— native_api 托管的面板（内嵌 doona 或本地目录）的入口页。
 *
 * 为什么这里不内嵌 iframe：honk 对面板的静态响应强制 X-Frame-Options: DENY
 * （crates/honk-core/src/native_api/ui.rs 的 serve() 统一加头，embedded 与目录两种模式都一样），
 * 浏览器会拒绝渲染。所以本页只做「给出地址 + 新窗口打开 + 说明为什么」。
 *
 * 数据来源分两处：
 *   - 服务总开关（uci honk.config.enabled）：走 LuCI 自己的 uci 接口。
 *   - native_api 的配置与运行态：走 /usr/libexec/honk-native-api-probe。
 *     不能在浏览器里直接请求 honk 的 GET /api —— 那是跨源，而 honk 默认不发 CORS 头
 *     （experimental.native_api.allow_origins 为空），必然被拦。探测只能放在路由器侧。
 */

var PROBE = '/usr/libexec/honk-native-api-probe';

function splitListen(listen) {
	var i = listen.lastIndexOf(':');

	if (i < 0)
		return null;

	return { host: listen.slice(0, i), port: listen.slice(i + 1) };
}

function isLoopback(host) {
	return host === '::1' || host === '[::1]' || host.indexOf('127.') === 0;
}

function isWildcard(host) {
	return host === '0.0.0.0' || host === '::' || host === '[::]';
}

/* 面板地址：具体 IP 就用它；通配监听用当前访问主机的名字；loopback 只能用 127.0.0.1 */
function panelUrl(listen) {
	var l = splitListen(listen);

	if (!l)
		return null;

	var host = isWildcard(l.host) ? (window.location.hostname || '127.0.0.1')
	         : l.host;

	return 'http://%s:%s/ui/'.format(host, l.port);
}

function copyText(text) {
	if (navigator.clipboard && navigator.clipboard.writeText)
		return navigator.clipboard.writeText(text);

	/* 明文 HTTP 下没有 clipboard API，退回临时 textarea + execCommand */
	var ta = E('textarea', { 'style': 'position:fixed;top:-1000px' }, text);
	document.body.appendChild(ta);
	ta.select();
	try { document.execCommand('copy'); } finally { ta.remove(); }

	return Promise.resolve();
}

function row(title, value, state) {
	var dot = null;

	if (state)
		dot = E('span', {
			'style': 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:%s'.format(
				state === 'ok' ? '#46a546' : (state === 'warn' ? '#e8a33d' : '#cc3333'))
		});

	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, title),
		E('div', { 'class': 'cbi-value-field' },
			dot ? [ dot, value ] : [ value ])
	]);
}

function hint(text, href, label) {
	return E('div', {
		'style': 'margin:8px 0 0;padding:8px 10px;border-radius:4px;background:#fdf6e3;color:#6b5a1e;font-size:13px'
	}, [
		E('span', {}, text),
		href ? [ ' ', E('a', { 'href': href }, label) ] : null
	].filter(function(v) { return v != null; }));
}

return view.extend({
	load: function() {
		return uci.load('honk');
	},

	render: function() {
		var svcEl = E('div', { 'class': 'cbi-section' });
		var body = E('div', {}, E('em', {}, _('Reading configuration…')));

		function render(data) {
			var cfg = (data && data.configured) || {};
			var probe = (data && data.probe) || {};
			var discovery = probe.discovery || null;
			var svcEnabled = uci.get('honk', 'config', 'enabled') === '1';

			var ui = cfg.ui || '';
			var listen = cfg.listen || '';
			var apiEnabled = cfg.enabled === true;
			var panel = panelUrl(listen);
			var loopback = (function() {
				var l = splitListen(listen);
				return l ? isLoopback(l.host) : false;
			})();

			var rows = [
				row(_('Service'), svcEnabled ? _('Enabled') : _('Disabled'), svcEnabled ? 'ok' : 'off'),
				row(_('Native API listener'), apiEnabled ? _('Enabled') : _('Disabled'), apiEnabled ? 'ok' : 'off'),
				row('listen', E('code', {}, listen || _('(default)'))),
				row('ui', E('code', {}, ui || _('(not configured)')), ui ? 'ok' : 'off'),
				row(_('Reachable'), probe.reachable ? _('Yes') : _('No'), probe.reachable ? 'ok' : 'err')
			];

			if (discovery && discovery.auth) {
				var mode = discovery.auth.mode;
				var label = mode === 'token' ? _('Token (use the secret)')
				          : (mode === 'password' ? (discovery.auth.setup_required
				                ? _('Password (first-time setup required)') : _('Password'))
				          : mode);

				rows.push(row(_('Panel login'), label));
			}

			dom.content(body, E('div', { 'class': 'cbi-section' }, rows));

			var actions = [];

			if (apiEnabled && ui && panel) {
				actions.push(E('button', {
					'class': 'cbi-button cbi-button-apply',
					'type': 'button',
					'click': function() { window.open(panel, '_blank', 'noopener'); }
				}, _('Open panel')));

				actions.push(E('button', {
					'class': 'cbi-button',
					'type': 'button',
					'click': function() {
						return copyText(panel).then(function() {
							ui.addNotification(null, E('p', {}, _('Panel address copied')), 'info');
						});
					}
				}, _('Copy address')));
			}

			dom.content(svcEl, null);

			if (panel)
				svcEl.appendChild(E('p', {
					'style': 'font-family:monospace;font-size:13px;margin:0 0 10px'
				}, panel));

			if (actions.length)
				svcEl.appendChild(E('p', { 'class': 'cbi-value-field' }, actions));

			if (!svcEnabled)
				svcEl.appendChild(hint(_('The honk service is disabled. Enable it on the Global Settings page.'),
					L.url('admin/services/honk/global'), _('Open Global Settings')));

			if (!cfg.present)
				svcEl.appendChild(hint(_('No native API configuration file found. Create one on the API Settings page.'),
					L.url('admin/services/honk/api'), _('Open API Settings')));
			else if (!apiEnabled)
				svcEl.appendChild(hint(_('The native API listener is disabled, so no panel is served.'),
					L.url('admin/services/honk/api'), _('Open API Settings')));
			else if (!ui)
				svcEl.appendChild(hint(_('No Web UI is configured. Set ui to embedded to use the built-in doona panel.'),
					L.url('admin/services/honk/api'), _('Open API Settings')));
			else if (!probe.reachable)
				svcEl.appendChild(hint(_('The listener is configured but not reachable. native_api settings only take effect after a service restart — and a binary built without the native-ui feature cannot serve embedded at all.')));

			if (ui && loopback)
				svcEl.appendChild(hint(_('The listener is bound to loopback, so the panel is only reachable from the router itself. To open it from another device, bind a LAN address or 0.0.0.0.')));
		}

		function refresh() {
			return fs.exec_direct(PROBE).then(function(out) {
				var data = null;

				try { data = JSON.parse(out || '{}'); } catch (e) { data = null; }

				if (!data)
					throw new Error(_('Unparsable probe output'));

				render(data);
			}).catch(function(err) {
				dom.content(body, E('div', { 'class': 'cbi-section' },
					hint(_('Unable to read the native API status: %s').format(err && err.message ? err.message : err))));
			});
		}

		/* 不先做 fs.stat 存在性检查：那走 rpcd 的 read 权限，而 ACL 只给了本脚本 exec ——
		   多要一个权限换一句更具体的提示不划算，直接调用、失败时在 catch 里说明。 */
		return refresh().then(function() {
			return E('div', { 'class': 'honk-cm' }, [
				E('h2', {}, _('WebUI')),
				body,
				svcEl,
				E('div', { 'style': 'margin-top:12px' }, E('button', {
					'class': 'cbi-button',
					'type': 'button',
					'click': function() { return refresh(); }
				}, _('Refresh')))
			]);
		});
	}
});
