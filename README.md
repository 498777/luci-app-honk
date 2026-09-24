# luci-app-honk（自建仓库 · 仅 apk）

> License: **AGPL-3.0-only**（[LICENSE](./LICENSE)）

OpenWrt 上 [honk](https://github.com/daeuniverse/honk)（eBPF 透明代理引擎，dae 兼容）的自建打包仓库，只产出 **apk**（OpenWrt 25.x apk 体系）。

## 构成

| 部分 | 说明 |
| --- | --- |
| 核心包 `honk` | 直接取上游 Release 的预编译静态 musl 二进制 `honk-core`，按架构下载（x86_64 / aarch64） |
| LuCI 包 `luci-app-honk` | JS 版界面（`htdocs/` 客户端视图 + `root/usr/share/luci/menu.d/` + `rpcd/acl.d/`），菜单显示名 **HONK**，不依赖 `luci-compat` |
| `update-honk` 工作流 | 每日检查上游新 Release，自动同步版本与校验和并触发构建 |

### 相对上游的调整

- **只出 apk**；
- **不依赖 `vmlinux-btf`**：移除条件依赖与 choice，固定使用内核自带 BTF；
- **geo 数据**：依赖 `v2ray-geoip` / `v2ray-geosite`，安装脚本在 `/usr/share/honk` 自动建立软链；
- **启动脚本**：新增 `/var/log/honk/honk.log` 三代轮转，不再劫持 `/tmp/resolv.conf`（上游从不创建日志文件）。

## 安装

### 一键安装（apk）

```sh
curl -fsSL "https://raw.githubusercontent.com/498777/luci-app-honk/main/Auto_Install_Script.sh" | sh -s luci-app-honk
```

默认安装 `honk` + `luci-app-honk` + 中文语言包；`sh -s honk` 只装主程序。

脚本行为：非 apk 体系直接退出；未发现内核 BTF 时给出提示；从 Release 拉取 `SHA256SUMS` 并对每个下载的 apk 做 sha256 校验（Release 未附校验文件时跳过并提示）；**不对下载的 apk 做任何改写**（`vmlinux-btf` 依赖由 CI 的 Makefile 断言保证，见 build-apk.yml 的 Assert 步骤）；安装完成后自动刷新 LuCI 缓存。其余参数（`--repo`、`--no-proxy`、`--gh-proxy`、`--force` 等）见脚本 `-h`。

### 手动安装与启用

```sh
apk add honk luci-app-honk luci-i18n-honk-zh-cn

uci set honk.config.enabled=1 && uci commit honk
/etc/init.d/honk start
```

### 前提与平台

- **BTF**：honk 是 eBPF CO-RE 程序，内核需开启 `CONFIG_DEBUG_INFO_BTF`（官方 24.10+ 的 x86_64 / armsr 默认开启）。未开启时 honk 可安装但无法启动；CI 有 Assert 步骤保证产物不含 `vmlinux-btf` 依赖。
- **架构**：上游只提供 x86_64 与 aarch64 的预编译静态二进制，包以 `@(x86_64||aarch64)` 限制架构。

## LuCI 界面

安装后 **服务 → HONK** 下为六个页签（JS 客户端渲染，`htdocs/luci-static/resources/view/honk/*.js`）。顶部是运行状态卡片（每 3 秒刷新），下面一张卡片里依次是 uci 启用开关、服务动作按钮、代码编辑器。每页都带 CodeMirror（`.dae` 语法高亮、代码折叠、括号匹配与自动补全、当前行高亮、格式化代码），底部为 Save / Save & Apply / Reset 三个按钮：

| 页签 | 编辑对象 |
| --- | --- |
| Global Settings | uci 启用开关 + `/etc/honk/config.dae` |
| DNS Settings | `/etc/honk/config.d/dns.dae` |
| Node Settings | `/etc/honk/config.d/node.dae`（节点 / 订阅 / 分组） |
| Routing Settings | `/etc/honk/config.d/route.dae` |
| Logs | `/var/log/honk/honk.log`（实时日志，末尾 1000 行） |
| API & Web UI | `/etc/honk/config.d/api.dae`（`native_api` 与内嵌 doona UI） |

**保存与生效是刻意的两步**，不是一次操作：

- Save / Save & Apply **只写盘**，并在提示里告诉你去点哪个按钮，**不会自动重载**。honk 文档写明「所有生效字段都要求重启；SIGHUP 拒绝其变更并保留当前 listener 与配置代次」—— 自动重载只会让用户以为已经生效。
- 真正生效由配置卡片里的按钮触发：默认「重载服务 → 立即重载」（`hot_reload`）；**API & Web UI 页是「重启服务 → 立即重启」**（`restart`），因为该文件里的 `native_api` 字段不支持热改。按钮名由视图传入的 `reloadAction` / `reloadLabel` / `reloadNowLabel` 定制。
- Reset 只把编辑器内容重新读回磁盘版本，不写盘。

文件写入与服务动作的执行权限由 `root/usr/share/rpcd/acl.d/luci-app-honk.json` 精确声明；运行状态由 `root/usr/libexec/honk-status` 提供（只放开该脚本的执行权限，不放开 `/proc`）。

默认 `node.dae` 是占位模板，直接启用会因 honk 启动校验失败而无法运行；需先在 Node 页签填入真实节点 / 订阅。

## 编译与发布

推送 `main`，或在 **Actions → Build apk → Run workflow** 手动触发（SDK 默认 `openwrt-25.12`，`sdk` / `packages` 可覆盖）。

Release 采用当天日期槽位 `honk_<UTC 日期>`，每次发布前清空该 tag 的旧附件并附带 `SHA256SUMS`。保留策略：Release 保留最近 2 个，workflow run 与 artifact 各保留 2 天。

源码树编译：

```sh
git clone https://github.com/498777/luci-app-honk package/honk
./scripts/feeds update -a && ./scripts/feeds install -a
make menuconfig   # Network -> Web Servers/Proxies -> luci-app-honk
make package/honk/compile V=s
```

产物位于 `bin/packages/<arch>/`，中文语言包由 `luci.mk` 自动带出。

## 目录结构

```
Auto_Install_Script.sh             一键安装（apk）
honk/                              核心包（下载预编译 honk-core + init / 配置）
luci-app-honk/                     LuCI 界面（htdocs 视图 + menu.d/acl.d + libexec 状态脚本 + po）
scripts/update_honk_version.sh     上游版本 / 校验和同步
scripts/check-po.sh                po 与源码一致性检查（CI 的 lint-po 调用）
.github/workflows/build-apk.yml                 取上游 release 二进制 + 编译 apk 并发布 Release
.github/workflows/update-honk.yml               每日检查上游 honk release 并自动 bump 版本
.github/workflows/build-honk-native-api.yml     临时：编译 fork 的 native-api 分支（仅出 artifact）
```

日志：`/var/log/honk/honk.log`（init 每次启动轮转，保留 3 代）。

## 第三方前端资源

`luci-app-honk/root/www/luci-static/resources/honk/` 下的 CodeMirror 资源为 **5.65.21 压缩版**，取自 cdnjs（`https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.21/`）。库本体的压缩版位于该包的 **根目录**（`codemirror.min.js` / `codemirror.min.css`），addon 与 theme 与上游同名：

| 仓库内路径 | 上游文件 |
| --- | --- |
| `lib/codemirror.min.js` | `codemirror.min.js` |
| `lib/codemirror.min.css` | `codemirror.min.css` |
| `addon/edit/matchbrackets.min.js` | `addon/edit/matchbrackets.min.js` |
| `addon/edit/closebrackets.min.js` | `addon/edit/closebrackets.min.js` |
| `addon/selection/active-line.min.js` | `addon/selection/active-line.min.js` |
| `addon/fold/foldcode.min.js` | `addon/fold/foldcode.min.js` |
| `addon/fold/foldgutter.min.js` | `addon/fold/foldgutter.min.js` |
| `addon/fold/foldgutter.min.css` | `addon/fold/foldgutter.min.css` |
| `addon/fold/indent-fold.min.js` | `addon/fold/indent-fold.min.js` |
| `theme/dracula.min.css` | `theme/dracula.min.css` |

`mode/dae/dae.js` 是本仓库自写的语法模式，保持未压缩以便修改。升级 CodeMirror 时需同步替换上表全部文件，并保证 `editor.js` 的 `CM_ASSETS` 与实际文件一一对应 —— 声明了却不存在、或存在却未被声明，都会使编辑器静默降级为普通文本框。

替换结果的校验命令（在 `luci-app-honk/root/www/luci-static/resources/honk/` 下执行）：

```sh
sha256sum -c <<'EOF'
d649a8d6bd5d0ca9bb3bef8212c9de6fa5599af3e3fe2898f94861dfe87bea7d  lib/codemirror.min.js
22f18b4dec95cc981a96f8e69f61f595314162fd102ba401abcd20b0674d9846  lib/codemirror.min.css
d0676055ec033a6f8f8f225b3fe47f8b6b2388e5beba4765d24152f106077806  addon/edit/matchbrackets.min.js
d48f92696b5cd5dc27055c73d1c34c4fa4e4e1e5e7b5baea58e5c23ca9777a36  addon/edit/closebrackets.min.js
6b5973470168d480f70a87affe7b1f93bea82369d790a23349c6a4816ae11708  addon/selection/active-line.min.js
4d101855eaa4334515bbdc6d96b1ff885ac83093d30cf792307e9e109622bd6e  addon/fold/foldcode.min.js
7d42c7d69bab903cf0ebb6864faf0ce097dbcabf9576dd8956bf97f3db8bb5cc  addon/fold/foldgutter.min.js
6c92093b9b94474c6d956b2989361928888e25fa695b140d8d8d0c0d2400773c  addon/fold/foldgutter.min.css
25d0dae3fc23df52e6ef52bf144a2a1b4418f130cb334eeb84359f5171e6cd46  addon/fold/indent-fold.min.js
d3a5434495be383a98973444d440d60b5148e67dd7c94e87369c2dcb829bb9e0  theme/dracula.min.css
EOF
```

## 许可证

**AGPL-3.0-only**（与 `honk/Makefile` 的 `PKG_LICENSE` 一致）。上游 honk-core 为 GPL-3.0 文本（dae 系源 AGPL-3.0）；LuCI 界面移植自 QiuSimons/luci-app-honk。

## 鸣谢

- [daeuniverse/honk](https://github.com/daeuniverse/honk) 及其贡献者（honk 引擎）；[QiuSimons/luci-app-honk](https://github.com/QiuSimons/luci-app-honk)（界面行为与文案的移植来源）；
- 本仓库（498777）：负责打包与每日同步上游；
- [OpenWrt LuCI](https://github.com/openwrt/luci) 框架与 luci-app 基础设施；JS 版界面（`form.TextValue` 自定义 load/write + `fs.*_direct` + menu.d/acl.d 的权限写法）参考 [ImmortalWrt/luci](https://github.com/immortalwrt/luci) 的 `luci-app-dae`。
