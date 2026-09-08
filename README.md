# luci-app-honk（自建仓库 · 仅 apk）

> **License: AGPL-3.0-only**（[LICENSE](./LICENSE)）。fork 自
> [QiuSimons/luci-app-honk](https://github.com/QiuSimons/luci-app-honk)（上游未声明许可证）。

OpenWrt 上 [honk](https://github.com/daeuniverse/honk)（eBPF 透明代理引擎，dae 兼容）的 LuCI 界面与二进制包。
honk 核心为预编译静态 musl 二进制，从上游 Release 按架构下载，本仓库不做本地编译。

相对上游的三处调整：

- **只出 apk**（OpenWrt 25.x 的 apk 体系，不再出 ipk）；
- **不依赖 `vmlinux-btf`**：从 `honk/Makefile` 移除条件依赖与 choice，固定使用内核自带 BTF；
- **init 脚本**：新增 `/var/log/honk/honk.log` 3 代轮转，去掉 `/tmp/resolv.conf` 劫持。

---

## 一键安装

```sh
curl -fsSL "https://raw.githubusercontent.com/498777/luci-app-honk/main/Auto_Install_Script.sh" | sh -s luci-app-honk
```

- 检测到非 apk 体系直接退出；默认安装 `honk` + `luci-app-honk` + 中文语言包；
- 若包内仍声明 `vmlinux-btf`（如指向上游的包），会自动拆包、从 `.PKGINFO` 剔除该依赖后重打包安装；
- 常用参数：`--repo someone/luci-app-honk`（换仓库）、`sh -s honk`（只装主程序）、`--keep-dep`（不去依赖，原样安装）。

启用服务：

```sh
uci set honk.config.enabled=1 && uci commit honk
/etc/init.d/honk start
```

LuCI 入口：**服务 → HONK**。首次使用前先把 `/etc/honk/config.d/node.dae` 的示例节点/订阅替换为实际配置。

---

## 前提：BTF

honk 是 eBPF CO-RE 程序，加载必须有 BTF。本仓库采用内核自带 BTF（`/sys/kernel/btf/vmlinux`，
需内核开启 `CONFIG_DEBUG_INFO_BTF`），因此：

- 包内**无 `depend = vmlinux-btf`**，`apk add` 不会拉入 BTF 包；CI 有 Assert 步骤兜底；
- 代价：内核未开 `CONFIG_DEBUG_INFO_BTF` 时 honk 可安装但无法启动。
  官方 24.10+ 的 x86_64 / armsr 默认带 BTF；自编译固件需自行开启。

## 编译与发布

推送 `main`，或在 **Actions → Build apk → Run workflow** 手动触发（SDK 默认 `openwrt-25.12`，
`packages`/`sdk` 可输入覆盖；默认编 `honk luci-app-honk`，中文包由 luci.mk 自动带出）。
Release 自动生成 `honk_<version>` 并附 apk。源码树编译：

```sh
git clone https://github.com/498777/luci-app-honk package/honk
./scripts/feeds update -a && ./scripts/feeds install -a
make menuconfig   # Network -> Web Servers/Proxies -> luci-app-honk
make package/honk/compile V=s
```

产物在 `bin/packages/<arch>/`。honk 只提供 x86_64 / aarch64 的预编译二进制。

---

## 目录与配置

```
Auto_Install_Script.sh             一键安装（apk）
honk/                              核心包（下载预编译 honk-core + init/配置）
luci-app-honk/                     LuCI 模块化界面（luasrc：controller/cbi/view/po）
scripts/update_honk_version.sh     上游版本/校验和同步
.github/workflows/                 build-apk（编译发布）/ update-honk（每日同步上游）
```

配置：`/etc/honk/config.dae`（含 `include config.d/*.dae`），拆分文件
`/etc/honk/config.d/{dns,node,route}.dae`。日志：`/var/log/honk/honk.log`
（init 每次启动轮转，保留 3 代；LuCI Logs 页读取该文件）。

## 许可证

采用 **AGPL-3.0-only**，与 `honk/Makefile` 的 `PKG_LICENSE` 一致。上游：honk-core 为 GPL-3.0
文本（dae 系源 AGPL-3.0），LuCI 部分上游未声明许可证。GPLv3 代码可并入 AGPLv3 作品，故整体
AGPL-3.0 无兼容性问题。若改用 GPL-3.0：替换根目录 `LICENSE`，并把 `honk/Makefile` 的
`PKG_LICENSE` 一并改为 `GPL-3.0-only`（两处需同步）。

> fork 源无许可证，严格讲代码默认保留所有权利；个人/自用通常不受影响，长期公开发布建议
> 请求上游补充 LICENSE。
