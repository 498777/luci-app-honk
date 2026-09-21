'use strict';
'require honk.editor as heditor';

/*
 * Node Settings —— 对照 Lua 版 luasrc/model/cbi/honk/node.lua
 * 编辑 /etc/honk/config.d/node.dae（节点 / 订阅 / 分组）
 */

return heditor.editorPage({
	key: 'node',
	title: _('Node Settings'),
	description: _('Configure nodes and groups for HONK.'),
	editorTitle: _('Node Configuration')
});
