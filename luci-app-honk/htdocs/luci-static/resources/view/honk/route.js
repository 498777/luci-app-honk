'use strict';
'require honk.editor as heditor';

/*
 * Routing Settings —— 对照 Lua 版 luasrc/model/cbi/honk/route.lua
 * 编辑 /etc/honk/config.d/route.dae
 */

return heditor.editorPage({
	key: 'route',
	title: _('Routing Settings'),
	description: _('Configure routing rules for HONK.'),
	editorTitle: _('Route Configuration')
});
