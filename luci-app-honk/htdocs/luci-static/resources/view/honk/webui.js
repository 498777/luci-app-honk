'use strict';
'require view';
'require fs';
'require uci';
'require ui';
'require dom';

/*
 * WebUI —— 直接把 native_api 托管的面板嵌进页面。
 *
 * 正常情况这个页面上只有面板本身，没有任何多余内容；**只有没法显示面板时**才出现一行提示
 * （服务停用 / 无配置文件 / native_api 未启用 / ui 未配置 / 连不上 / 该二进制拒绝被内嵌）。
 *
 * 两处判断都必须在路由器侧做（见 /usr/libexec/honk-native-api-probe）：
 *   1) honk 的 GET /api 默认不发 CORS 头，浏览器从 LuCI 的源跨源请求会被拦；
 *   2) **iframe 被 X-Frame-Options 拒绝时是浏览器静默行为** —— 页面里的 JS 拿不到错误，
 *      onload 甚至可能照常触发，所以"能不能嵌"只能由服务端读响应头来判断。
 *      （honk 自 ca465bcc0 起已删掉该头以支持被 LuCI 嵌入；更早的二进制仍会发 DENY。）
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

	var host = isWildcard(l.host) ? (window.location.hostname || '127.0.0.1') : l.host;

	return 'http://%s:%s/ui/'.format(host, l.port);
}

function hint(text, href, label) {
	return E('div', {
		'style': 'margin:12px 0 0;padding:10px 12px;border-radius:4px;background:#fdf6e3;color:#6b5a1e;font-size:13px;line-height:1.6'
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
		var host = E('div', { 'class': 'honk-cm' });

		function render(data) {
			var cfg = (data && data.configured) || {};
			var probe = (data && data.probe) || {};
			var svcEnabled = uci.get('honk', 'config', 'enabled') === '1';
			var url = panelUrl(cfg.listen || '');
			var blocked = null;

			if (!svcEnabled)
				blocked = hint(_('The honk service is disabled. Enable it on the Global Settings page.'),
					L.url('admin/services/honk/global'), _('Open Global Settings'));
			else if (!cfg.present)
				blocked = hint(_('No native API configuration file was found. Create one on the API Settings page.'),
					L.url('admin/services/honk/api'), _('Open API Settings'));
			else if (cfg.enabled !== true)
				blocked = hint(_('The native API listener is disabled, so nothing is served.'),
					L.url('admin/services/honk/api'), _('Open API Settings'));
			else if (!cfg.ui)
				blocked = hint(_('No Web UI is configured. Set ui to embedded to serve the built-in doona panel.'),
					L.url('admin/services/honk/api'), _('Open API Settings'));
			else if (!probe.reachable)
				blocked = hint(_('The panel is not reachable. native_api settings only take effect after a service restart.'));
			else if (probe.framing === 'deny')
				blocked = hint(_('This build refuses to be embedded (X-Frame-Options: DENY), so the frame would stay blank. Use a build from ca465bcc0 or later.'));

			if (blocked || !url)
				return dom.content(host, blocked || hint(_('Unable to determine the panel address from the native API configuration.')));

			dom.content(host, E('iframe', {
				'src': url,
				'title': _('WebUI'),
				'loading': 'eager',
				'referrerpolicy': 'no-referrer',
				'style': 'width:100%;height:78vh;min-height:420px;border:0;display:block;border-radius:4px'
			}));
		}

		fs.exec_direct(PROBE).then(function(out) {
			var data = null;

			try { data = JSON.parse(out || '{}'); } catch (e) { data = null; }

			if (!data)
				return dom.content(host, hint(_('Unable to read the native API status: %s').format(_('unparsable probe output'))));

			render(data);
		}).catch(function(err) {
			dom.content(host, hint(_('Unable to read the native API status: %s').format(err && err.message ? err.message : err)));
		});

		return host;
	}
});
