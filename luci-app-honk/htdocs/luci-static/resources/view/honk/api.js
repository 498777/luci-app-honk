'use strict';
'require honk.editor as heditor';

/*
 * API & Web UI —— 编辑 /etc/honk/config.d/api.dae（native_api / clash_api 块）
 *
 * 两点值得留意：
 *
 * 1) 服务动作是「重启」而不是「重载」。native_api 的所有生效字段（enabled / listen /
 *    secret / ui / config_write / record_* / allowed_hosts / allow_origins …）都不支持热改：
 *    honk 收到 SIGHUP 时会【忽略这些变更】并保留当前 listener 与配置代次 —— 注意是忽略，
 *    不是报错。所以如果这里沿用默认的 hot_reload，界面会提示成功而实际毫无变化。
 *
 * 2) 本文件含监听凭据（secret），honk 会把它判为「凭据源」而在 API 侧标记为只读，
 *    且 API 明文禁止修改 native_api 设置。也就是说 doona 面板永远改不了这一块 ——
 *    这正是本页面存在的理由：只有直接写文件的途径才能改它。
 */

return heditor.editorPage({
	key: 'api',
	title: _('API & Web UI'),
	description: _('Configure the native API listener and the embedded Web UI. Saving requires a service restart to take effect.'),
	editorTitle: _('API Configuration'),
	reloadAction: 'restart',
	reloadLabel: _('Restart Service'),
	reloadNowLabel: _('Restart Now'),
	reloadOk: _('Service restarted successfully'),
	reloadFail: _('Restart failed: %s')
});
