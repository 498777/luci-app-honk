'use strict';
'require view';
'require fs';
'require poll';
'require honk.editor as heditor';

/*
 * Logs —— 对照 Lua 版 luasrc/view/honk/honk_log.htm
 * 只读日志视图：定时刷新 + 首屏自动滚到底部 + 上/下滚动按钮。
 * 与 Lua 版一致只显示末尾 1000 行（那边是服务端 tail -n 1000）；
 * 读取走 read_direct（cgi-io），避开 ubus 报文大小限制，权限规则与 fs.read 相同。
 */

var MAX_LINES = 1000;

return view.extend({
	render: function() {
		var textarea = E('textarea', {
			id: 'honk_log_textarea',
			'class': 'cbi-input-textarea',
			'readonly': 'readonly',
			'wrap': 'off',
			'rows': 30,
			'style': 'width:calc(100% - 20px); height:600px; margin:10px; font-family:"Fira Code","Monaco","Consolas",monospace; font-size:12px; white-space:pre; overflow:auto'
		});

		var followed = false;

		function load() {
			return fs.read_direct(heditor.PATHS.log, 'text').then(function(data) {
				var lines = (data || '').split('\n');

				if (lines.length > MAX_LINES)
					lines = lines.slice(-MAX_LINES);

				textarea.value = lines.join('\n');

				if (!followed) {
					textarea.scrollTop = textarea.scrollHeight;
					followed = true;
				}
			}).catch(function() {
				/* 日志文件还不存在等情况，保持上一次内容 */
			});
		}

		function scroll(dir) {
			textarea.scrollTop = (dir == 'top') ? 0 : textarea.scrollHeight;
		}

		var btnTop = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'type': 'button',
			'click': function() { scroll('top'); }
		}, _('Scroll to top'));

		var btnBottom = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'type': 'button',
			'click': function() { scroll('bottom'); }
		}, _('Scroll to bottom'));

		poll.add(load, 3);
		load();

		return E('div', {}, [
			E('fieldset', { 'class': 'cbi-section' }, [
				E('div', { style: 'margin:10px 10px 0' }, btnTop),
				textarea,
				E('div', { style: 'margin:0 10px 10px' }, btnBottom)
			])
		]);
	}
});
