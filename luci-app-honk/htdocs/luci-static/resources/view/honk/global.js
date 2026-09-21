'use strict';
'require form';
'require honk.editor as heditor';

/*
 * Global Settings —— 对照 Lua 版 luasrc/model/cbi/honk/global.lua
 * uci 开关（enabled）+ /etc/honk/config.dae 编辑器
 */

return heditor.editorPage({
	key: 'config',
	title: _('Global Settings'),
	description: _('Configure global settings for HONK.'),
	editorTitle: _('Global Configuration'),
	editorDescription: _('Correctly configure the include field for separate-config to work, or enter complete configuration here.'),
	uciSection: function(section) {
		var enable = section.option(form.Flag, 'enabled', _('Start Service'));
		enable.rmempty = false;
	}
});
