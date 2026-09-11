# luci-app-honk（自建仓库 · 仅 apk）

> **License: AGPL-3.0-only**（[LICENSE](./LICENSE)）。

OpenWrt 上 [honk](https://github.com/daeuniverse/honk)（eBPF 透明代理引擎，dae 兼容）的自建打包仓库：

- 二进制：`honk-core` 为上游预编译的静态 musl 二进制，从 Release 按架构下载（`update-honk` 每日检查上游新 Release 并自动同步版本/校验和、触发构建）；
- LuCI：模块化 luasrc 界面，菜单显示名统一 **HONK**；
- init：新增 `/var/log/honk/honk.log` 3 代轮转，不劫持 `/tmp/resolv.conf`。

相对上游的调整：

- **只出 apk**（OpenWrt 25.x apk 体系）；
- **不依赖 `vmlinux-btf`**：移除条件依赖与 choice，固定使用内核自带 BTF；
- **geo 数据**：依赖 `v2ray-geoip`/`v2ray-geosite`；安装脚本自动在 `/usr/share/honk` 与 `/usr/share/dae` 建立软链；
- **启动脚本**：新增日志轮转、去掉 resolv.conf 劫持（上游从不创建日志文件）。

## 一键安装

```sh
curl -fsSL "https://raw.githubusercontent.com/498777/luci-app-honk/main/Auto_Install_Script.sh" | sh -s luci-app-honk
```

- 默认装全套：`honk` + `luci-app-honk` + 中文语言包；
- 只装主程序、不带 LuCI：`sh -s honk`；
- 脚本行为：非 apk 体系直接退出；未发现内核 BTF 时给出提示；若包内仍声明
  `vmlinux-btf` 会自动拆包剔除后安装；装完自动刷新 LuCI 缓存；
- 其它参数（`--repo` 换仓库、`--keep-dep` 原样安装）见脚本帮助（`-h`）。

## LuCI 界面（模块化）

安装后 **服务 → HONK** 下五个页签，配置拆分、每页带 CodeMirror 编辑器与 Reload 按钮：

| 页签 | 编辑对象 |
| --- | --- |
| Global Settings | uci（启用/日志轮转）+ `/etc/honk/config.dae` |
| DNS Settings | `/etc/honk/config.d/dns.dae` |
| Node Settings | `/etc/honk/config.d/node.dae`（节点/订阅/分组） |
| Routing Settings | `/etc/honk/config.d/route.dae` |
| Logs | `/var/log/honk/honk.log`（实时日志） |

默认 `node.dae` 是占位模板：**先在 Node 页签替换为真实节点/订阅再启用**，否则
honk 启动校验失败。

## 安装与启用

```sh
apk add honk luci-app-honk luci-i18n-honk-zh-cn

uci set honk.config.enabled=1 && uci commit honk
/etc/init.d/honk start
```

## 前提与平台说明

- **BTF**：honk 是 eBPF CO-RE 程序，内核需开启 `CONFIG_DEBUG_INFO_BTF`（官方 24.10+ 的
  x86_64 / armsr 默认开启）。未开启时 honk 可安装但无法启动。CI 有 Assert 步骤保证
  产物不含 `vmlinux-btf` 依赖。
- **架构**：honk 只提供 x86_64 与 aarch64 的预编译静态二进制，包通过
  `@(x86_64||aarch64)` 限制架构。

## 编译与发布

推送 `main`，或在 **Actions → Build apk → Run workflow** 手动触发（SDK 默认
`openwrt-25.12`，`packages`/`sdk` 可输入覆盖）。Release 生成 `honk_<version>`。
每次发布前会自动清空该 tag 的旧附件。
源码树编译：

```sh
git clone https://github.com/498777/luci-app-honk package/honk
./scripts/feeds update -a && ./scripts/feeds install -a
make menuconfig   # Network -> Web Servers/Proxies -> luci-app-honk
make package/honk/compile V=s
```

产物在 `bin/packages/<arch>/`。中文语言包由 luci.mk 自动带出。

## 目录

```
Auto_Install_Script.sh             一键安装（apk）
honk/                              核心包（下载预编译 honk-core + init/配置）
luci-app-honk/                     LuCI 模块化界面（luasrc：controller/cbi/view/po）
scripts/update_honk_version.sh     上游版本/校验和同步
.github/workflows/                 build-apk（编译发布）/ update-honk（每日同步上游）
```

日志：`/var/log/honk/honk.log`（init 每次启动轮转，保留 3 代）。

## 许可证

**AGPL-3.0-only**，与 `honk/Makefile` 的 `PKG_LICENSE` 一致。上游：honk-core 为
GPL-3.0 文本（dae 系源 AGPL-3.0）；LuCI 界面移植自 QiuSimons/luci-app-honk（上游未
声明许可证，文件头保留版权）。GPLv3 代码可并入 AGPLv3 作品，故整体 AGPL-3.0 无兼容性
问题。若改用 GPL-3.0：替换根目录 `LICENSE`，并把 `honk/Makefile` 的 `PKG_LICENSE`
一并改为 `GPL-3.0-only`。
