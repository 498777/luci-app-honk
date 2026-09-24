'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require poll';
'require rpc';
'require baseclass';

/*
 * luci-app-honk 共用工具（JS 版）
 *
 * 对照 Lua 版：luasrc/model/honk_tools.lua（init_editor / add_editor）+ view/honk/honk_editor.htm
 * 保持一致的部分：同一套 CodeMirror 资源与选项（mode=dae、dracula、fold gutter、自动补括号）、
 * 同一个 Format Code 规则、顶部运行状态卡片；保存与重载刻意解耦（重载由「重载服务」独立按钮触发）。
 */

var SERVICE = 'honk';
var INITD = '/etc/init.d/honk';

var PATHS = {
	config: '/etc/honk/config.dae',
	dns: '/etc/honk/config.d/dns.dae',
	node: '/etc/honk/config.d/node.dae',
	route: '/etc/honk/config.d/route.dae',
	log: '/var/log/honk/honk.log'
};

/* ---------------------------------------------------------------- CodeMirror */

var CM_ASSETS = [
	/* 第三方资源一律使用压缩版（同版本 5.65.21）；未压缩源码见 vendor 说明 */
	{ css: 'honk/lib/codemirror.min.css' },
	{ css: 'honk/addon/fold/foldgutter.min.css' },
	{ css: 'honk/theme/dracula.min.css' },
	{ js: 'honk/lib/codemirror.min.js' },
	{ js: 'honk/addon/edit/matchbrackets.min.js' },
	{ js: 'honk/addon/edit/closebrackets.min.js' },
	{ js: 'honk/addon/selection/active-line.min.js' },
	{ js: 'honk/addon/fold/foldcode.min.js' },
	{ js: 'honk/addon/fold/foldgutter.min.js' },
	{ js: 'honk/addon/fold/indent-fold.min.js' },
	{ js: 'honk/mode/dae/dae.js' }
];

var CM_STYLE = [
	'.honk-cm .CodeMirror { margin-right: 200px; border: 1px solid #6272a4; border-radius: 6px; height: auto;',
	'	min-height: 400px; font-family: "Fira Code", "Monaco", "Consolas", monospace;',
	'	font-size: 13px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }',
	'.honk-cm .cm-s-dracula.CodeMirror { background-color: #282a36 !important; color: #f8f8f2 !important; }',
	'.honk-cm .cm-s-dracula .CodeMirror-gutters { border-right: none !important; background-color: #282a36 !important; }',
	'.honk-cm .cm-s-dracula .CodeMirror-linenumber { color: #6272a4 !important; }',
	'.honk-cm .cm-s-dracula .cm-keyword, .honk-cm .cm-s-dracula .cm-operator { color: #ff79c6 !important; font-weight: bold; }',
	'.honk-cm .cm-s-dracula .cm-variable-3 { color: #ffb86c !important; }',
	'.honk-cm .cm-s-dracula .cm-def { color: #50fa7b !important; }',
	'.honk-cm .cm-s-dracula .cm-number { color: #bd93f9 !important; }',
	'.honk-cm .cm-s-dracula .cm-string { color: #f1fa8c !important; }',
	'.honk-cm .cm-s-dracula .cm-comment { color: #6272a4 !important; font-style: italic; }',
	/* 手机端（<768px）：标签堆到上方、字段占满宽度，编辑器去掉右侧 200px 边距 */
	'@media (max-width: 767px) {',
	'	.honk-cm .cbi-value { flex-direction: column; align-items: stretch; }',
	'	.honk-cm .cbi-value-title { flex: none; text-align: left; padding: 0 0 6px 0; }',
	'	.honk-cm .cbi-value-field { margin-left: 0; }',
	'	.honk-cm .CodeMirror { margin-right: 0; min-height: 320px; }',
	'}'
].join('\n');

var cmReady = null;

/* 取静态资源 URL：优先 L.resource()，并保留兜底（某些 LuCI 构建/旧版没有该助手） */
function resource(path) {
	if (typeof L.resource == 'function')
		return L.resource(path);
	if (L.env && L.env.resource)
		return L.env.resource + path;
	return '/luci-static/resources/' + path;
}

/* 样式注入目标：视图节点内部（传入 renderWidget 返回的 node）。
   - 不能挂 document.head：aurora 等主题的同文档路由只把 #view 之外的样式表视为"外来"
     （router-aurora.js 的 sheets() 会 filter 掉 view.contains(t) 的节点），一旦判定文档
     被污染就放弃无刷新切换、退回整页加载。
   - 也不能挂 #view 直属：LuCI 是在 renderWidget 里同步构建节点、随后才用
     dom.content(#view, node) 整体替换 #view 的内容，而我们的注入发生在 render 之后的
     第一个微任务里、早于那次替换，会被连带清掉（症状：编辑器塌陷、只剩一列 gutter）。
   挂进视图节点内部则随该节点一起进入 #view：既在 #view 之内、又随视图切换被释放。 */
function styleHost(node) {
	return node || document.getElementById('view') || document.body || document.head;
}

/* 加载单个脚本，失败自动重试：uhttpd 偶发丢连接会让 onerror 触发，
   进而 loadCodeMirror reject、编辑器退回普通文本框，重试可吞掉这类瞬时错误 */
function loadScript(url) {
	return new Promise(function(resolve, reject) {
		var attempt = 0;

		(function next() {
			var el = E('script', { src: url });

			/* 动态插入的 <script> 默认 async（谁先加载完谁先执行），必须显式关掉才能保证
			   codemirror.min.js 先于 addon/mode 执行 —— 否则 mode 注册时 CodeMirror 未定义，
			   语法模式注册失败 → 空模式 → 编辑器内容全白 */
			el.async = false;

			el.onload = function() { resolve(); };
			el.onerror = function() {
				el.remove();

				if (++attempt < 3)
					window.setTimeout(next, 250);
				else
					reject(new Error('无法加载 ' + url));
			};

			document.head.appendChild(el);
		})();
	});
}

/* 确保编辑器的样式表就位。样式随视图切换会被释放（见 styleHost），
   所以每次调用都补齐；已存在的不重复注入、也不重复等待。 */
function ensureCmStyles(node) {
	var pending = [];

	var host = styleHost(node);

	/* 去重必须限定在"本视图节点内"：主题的同文档路由是「先渲染新视图、后释放旧视图」，
	   用文档级查询会在新旧共存的窗口期命中旧视图那张即将被释放的样式表，于是新视图
	   不再注入 —— 症状即"切 Tab 后样式丢失、再点一次才恢复"。 */
	if (!host.querySelector('#honk-cm-style'))
		host.appendChild(E('style', { id: 'honk-cm-style' }, CM_STYLE));

	CM_ASSETS.forEach(function(asset) {
		if (!asset.css)
			return;

		var url = resource(asset.css);

		/* 主题/基础样式也纳入等待：否则编辑器可能先于 CSS 渲染，
		   偶发「没吃到主题色」，刷新后才正常（缓存命中） */
		if (host.querySelector('link[href="' + url + '"]'))
			return;

		pending.push(new Promise(function(resolve) {
			var el = E('link', { rel: 'stylesheet', href: url });
			var done = false;

			el.onload = function() { if (!done) { done = true; resolve(); } };
			el.onerror = function() { if (!done) { done = true; resolve(); } };
			host.appendChild(el);

			/* 兜底：极端情况 onload/onerror 都不触发，3 秒后放行（最坏只是没主题色） */
			window.setTimeout(function() { if (!done) { done = true; resolve(); } }, 3000);
		}));
	});

	return Promise.all(pending);
}

function loadCodeMirror(node) {
	/* 样式每次都要补齐（可能随上一个视图被释放），JS 只加载一次 */
	var styles = ensureCmStyles(node);

	if (cmReady)
		return Promise.all([ cmReady, styles ]);

	var pending = [];

	CM_ASSETS.forEach(function(asset) {
		if (asset.css)
			return;

		var url = resource(asset.js);

		if (document.querySelector('script[src="' + url + '"]'))
			return;

		pending.push(loadScript(url));
	});

	cmReady = Promise.all(pending).then(function() {
		if (typeof CodeMirror == 'undefined')
			throw new Error('CodeMirror failed to load');
	}).catch(function(err) {
		/* 失败不永久缓存，下次调用可重试 —— 否则一次偶发失败会让整个会话退回文本框 */
		cmReady = null;
		throw err;
	});

	return Promise.all([ cmReady, styles ]);
}


/* 与 Lua 版 Format Code 完全相同的规则 */
function formatValue(content) {
	return content.split('\n').map(function(line) {
		var t = line.trim();

		if (t.indexOf('#') == 0 || t.indexOf('//') == 0)
			return line;

		line = line.replace(/\s*->\s*/g, ' -> ');
		line = line.replace(/\s*&&\s*/g, ' && ');
		line = line.replace(/(['"])([a-zA-Z0-9_-]+)\1/g, function(match, quote, word) {
			return word;
		});
		return line.trimEnd();
	}).join('\n');
}

/* 从 form.TextValue 渲染出的节点里取出 textarea（返回形态随 LuCI 版本而变） */
function findTextarea(node) {
	if (!node)
		return null;

	if (Array.isArray(node)) {
		for (var i = 0; i < node.length; i++) {
			var found = findTextarea(node[i]);
			if (found)
				return found;
		}
		return null;
	}

	if (node.nodeType == 1) {
		if (node.tagName == 'TEXTAREA')
			return node;
		return node.querySelector ? node.querySelector('textarea') : null;
	}

	return null;
}

/* 编辑器在脱离文档（尚未挂载、零尺寸）时创建，语法高亮/主题色的 token 染色会被推迟，
   导致首屏内容全为默认白色；需在真正可见后 refresh 一次重新染色 */
function refreshWhenVisible(cm) {
	var attempts = 0;

	(function tick() {
		var el = cm.getWrapperElement();

		if (el && el.offsetParent !== null)
			cm.refresh();
		else if (++attempts < 200)
			window.setTimeout(tick, 50);
	})();
}

function attachCodeMirror(textarea, node) {
	/* 包一层 Promise：loadCodeMirror() 的同步异常（例如环境缺 L.resource）也能被 catch 到 */
	return Promise.resolve().then(function() {
		return loadCodeMirror(node);
	}).then(function() {
		var cm = CodeMirror.fromTextArea(textarea, {
			mode: 'dae',
			indentUnit: 4,
			tabSize: 4,
			styleActiveLine: true,
			lineNumbers: true,
			theme: 'dracula',
			lineWrapping: true,
			matchBrackets: true,
			autoCloseBrackets: true,
			foldGutter: true,
			gutters: [ 'CodeMirror-linenumbers', 'CodeMirror-foldgutter' ]
		});

		cm.on('inputRead', function(editor, change) {
			if (change.origin != '+input')
				return;

			var pairs = { '{': '}', '[': ']', '(': ')', '"': '"', "'": "'" };
			var close = pairs[change.text[0]];

			if (close) {
				var cur = editor.getCursor();
				editor.replaceRange(close, cur);
				editor.setCursor(cur);
			}
		});

		/* LuCI 提交表单时读 textarea，这里保持同步（Lua 版亦如此） */
		cm.on('change', function() {
			textarea.value = cm.getValue();
		});

		/* 防御：若表单在挂载之后才写入 textarea（异步 load 的时序差异），以 textarea 为准 */
		if (textarea.value !== cm.getValue())
			cm.setValue(textarea.value || '');
		else
			textarea.value = cm.getValue();

		/* 可见后刷新，确保首屏语法高亮/主题色正确 */
		refreshWhenVisible(cm);

		return cm;
	});
}

/* ------------------------------------------- 带 CodeMirror 的 form.TextValue */

var CodeMirrorValue = form.TextValue.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		var node = form.TextValue.prototype.renderWidget.apply(this, arguments);
		var self = this;
		var textarea = findTextarea(node);

		if (textarea) {
			attachCodeMirror(textarea, node).then(function(cm) {
				self.editor = cm;
			}).catch(function(err) {
				ui.addNotification(null, E('p', _('Editor unavailable, plain textarea is used: %s').format(err.message)), 'error');
			});
		}

		return node;
	}
});

/* --------------------------------------------------------------- 状态卡片 */

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function statusCard() {
	var statusNode = E('span', {}, _('Collecting data...'));
	var memNode = E('div', { style: 'font-size: 12px; color: var(--text-color-medium); margin-top: 4px' });

	function renderStatus(running) {
		statusNode.innerHTML = '';
		statusNode.appendChild(E('span', { style: 'display:inline-block; width:8px; height:8px; border-radius:50%; background:' + (running ? '#46a546' : '#cc3333') + '; margin-right:6px; vertical-align:middle' }));
		statusNode.appendChild(E('strong', {}, SERVICE.toUpperCase() + ' ' + (running ? _('RUNNING') : _('NOT RUNNING'))));
	}

	function refresh() {
		return fs.exec_direct('/usr/libexec/honk-status').then(function(stdout) {
			var data = JSON.parse(stdout || '{}');
			var running = !!data.running;
			renderStatus(running);
			memNode.textContent = data.memory_kb
				? '%s (%s MB)'.format(_('Memory Usage'), (data.memory_kb / 1024).toFixed(1))
				: '';
		}).catch(function() {
			/* helper 不可用时退回 ubus service list（仅运行状态，无内存占用） */
			return callServiceList(SERVICE).then(function(res) {
				var instances = (res && res[SERVICE] && res[SERVICE].instances) || {};
				var running = Object.keys(instances).length > 0;
				renderStatus(running);
				memNode.textContent = '';
			}).catch(function() {
				renderStatus(false);
				memNode.textContent = '';
			});
		});
	}

	poll.add(refresh, 3);
	refresh();

	return E('fieldset', { 'class': 'cbi-section' }, [
		E('h3', {}, _('Running Status')),
		E('div', { style: 'margin: 6px 0 0' }, statusNode),
		memNode
	]);
}

/* ------------------------------------------- 页面工厂：一个配置文件 = 一个页签 */

function editorPage(opts) {
	var path = PATHS[opts.key];

	return view.extend({
		render: function() {
			var m = new form.Map('honk', opts.title, opts.description);

			if (opts.uciSection) {
				var st = m.section(form.TypedSection, 'honk');
				st.anonymous = true;
				opts.uciSection(st);
			}

			var s = m.section(form.NamedSection, 'config', 'honk');
			s.anonymous = true;

			var o = s.option(CodeMirrorValue, '_' + opts.key, opts.editorTitle || _('Configuration'), opts.editorDescription);
			o.rows = 28;
			o.monospace = true;
			o.wrap = 'off';
			o.load = function() {
				return fs.read(path).then(function(data) {
					return data != null ? data : '';
				}).catch(function(err) {
					ui.addNotification(null, E('p', _('Unable to read %s: %s').format(path, err.message)), 'error');
					return '';
				});
			};
			o.write = function(section_id, value) {
				return fs.write(path, value, 416 /* 0640，与 honk 启动脚本收紧后的权限一致 */);
			};

			return m.render().then(L.bind(function(node) {
				this.formMap = m;
				this.editorOption = o;

				/* 收集顶层 section（TypedSection=已启用 / NamedSection=编辑器） */
				var sections = [];
				for (var i = 0; i < node.children.length; i++) {
					var el = node.children[i];
					if (el.classList && el.classList.contains('cbi-section'))
						sections.push(el);
				}

				var enabledValue = null, editorSection = null;
				if (opts.uciSection && sections.length >= 2) {
					enabledValue = sections[0].querySelector('.cbi-value');
					editorSection = sections[1];
				}
				else if (sections.length >= 1) {
					editorSection = sections[0];
				}

				var editorValue = editorSection ? editorSection.querySelector('.cbi-value') : null;
				var editorField = editorValue ? editorValue.querySelector('.cbi-value-field') : null;

				/* Format Code：与编辑器标题同一行、靠右 */
				var formatBtn = E('button', {
					'class': 'cbi-button cbi-button-apply',
					'type': 'button',
					'click': function() {
						var cm = o.editor;
						if (cm) {
							cm.operation(function() {
								var cur = cm.getCursor();
								cm.setValue(formatValue(cm.getValue()));
								for (var k = 0; k < cm.lineCount(); k++)
									cm.indentLine(k, 'smart');
								cm.setCursor(cur);
							});
						}
						else {
							var ta = findTextarea(editorValue);
							if (ta)
								ta.value = formatValue(ta.value);
						}
					}
				}, _('Format Code'));

				if (editorField)
					editorField.insertBefore(
						E('div', { style: 'margin-bottom:4px' }, formatBtn),
						editorField.firstChild);

				/* Reload：标签「重载服务」+ 按钮「立即重载」，不依赖表单 Save */
				var reloadBtn = E('button', {
					'class': 'cbi-button cbi-button-action',
					'type': 'button',
					'click': function() {
						/* 不能用 L.resolveDefault(..., null) 包住：它会把 rejection 吞成 null，
						   下面的 .catch 永远进不去，重载失败也不会有任何提示 */
						return fs.exec_direct(INITD, [ 'hot_reload' ]).then(function() {
							ui.addNotification(null, E('p', _('Service reloaded successfully')), 'info');
						}).catch(function(err) {
							ui.addNotification(null, E('p', _('Reload failed: %s').format(err && err.message ? err.message : err)), 'error');
						});
					}
				}, _('Reload Now'));

				/* 单卡片：启动服务 → 重载服务 → 编辑器 */
				var card = E('div', { 'class': 'cbi-section' });

				if (enabledValue)
					card.appendChild(enabledValue);

				card.appendChild(E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Reload Service')),
					E('div', { 'class': 'cbi-value-field' }, reloadBtn)
				]));

				if (editorValue)
					card.appendChild(editorValue);

				sections.forEach(function(s) {
					if (s.parentNode)
						s.parentNode.removeChild(s);
				});

				node.appendChild(card);

				/* 运行状态卡片置于「全局设置」标题（及描述）下方、配置卡片上方 */
				if (opts.uciSection)
					node.insertBefore(statusCard(), card);

				return E('div', { 'class': 'honk-cm' }, node);
			}, this));
		},

		handleSave: function(ev) {
			return this.formMap.save();
		},

		handleSaveApply: function(ev, mode) {
			/* 保存与重载刻意解耦：重载由「重载服务 → 立即重载」单独触发。
			   自动 hot_reload 在这里是有害的 —— native_api 等块的改动本来就会被 SIGHUP 拒绝
			   （honk 文档："所有生效字段都要求重启；SIGHUP 拒绝其变更并保留当前 listener
			   与配置代次"），自动触发只会让用户以为已经生效。 */
			return this.handleSave(ev).then(function() {
				ui.addNotification(null, E('p', _('Configuration saved. Use "Reload Now" to apply it.')), 'info');
			});
		},

		/* Reset = 放弃编辑，重新载入磁盘上的内容（CodeMirror 需同步，故自行实现） */
		handleReset: function() {
			return fs.read(path).then(L.bind(function(data) {
				var option = this.editorOption;

				if (option && option.editor)
					option.editor.setValue(data != null ? data : '');
			}, this));
		}
	});
}

/*
 * LuCI 要求模块 return 一个 Class 子类（luci.js 会做 Class.isSubclass 检查，
 * 否则报 `"xxx" factory yields invalid constructor`）；用 baseclass.extend 暴露这些成员，
 * 成员会同时挂到构造器上，因此调用方可以写成 heditor.editorPage(...)（fs.read 同理）。
 */
return baseclass.extend({
	PATHS: PATHS,
	SERVICE: SERVICE,
	INITD: INITD,
	loadCodeMirror: loadCodeMirror,
	attachCodeMirror: attachCodeMirror,
	formatValue: formatValue,
	CodeMirrorValue: CodeMirrorValue,
	statusCard: statusCard,
	editorPage: editorPage
});
