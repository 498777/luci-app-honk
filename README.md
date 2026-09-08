# luci-app-honk（自建仓库 · 仅 apk · 无 vmlinux-btf 依赖）

> **License: AGPL-3.0-only**，完整文本见 [LICENSE](./LICENSE)。
> 本仓库 fork 自 [QiuSimons/luci-app-honk](https://github.com/QiuSimons/luci-app-honk)（该仓库未声明许可证）。

OpenWrt 上 [honk](https://github.com/daeuniverse/honk)（eBPF 透明代理引擎，dae 兼容）的 LuCI 界面与二进制包。

本仓库 fork 自 [QiuSimons/luci-app-honk](https://github.com/QiuSimons/luci-app-honk)，做了三处调整：

| 项目 | 上游 | 本仓库 |
| --- | --- | --- |
| 产物格式 | ipk + apk | **只出 apk**（OpenWrt 24.10+ / 25.x 的 apk 体系） |
| `vmlinux-btf` | `+HONK_USE_VMLINUX_BTF:vmlinux-btf` 条件依赖 | **已移除**，固定使用内核自带 BTF |
| 启动脚本 | 无日志轮转、劫持 `/tmp/resolv.conf` | **新增 `/var/log/honk/honk.log` 3 代轮转**，去掉 resolv.conf 劫持（见第六节） |

包结构沿用上游，两个包：

- `honk`：从 `daeuniverse/honk` 的 GitHub Release 按架构下载预编译静态 musl `honk-core`，不在本地编译。
- `luci-app-honk`：参考 `luci-app-dae` 的 LuCI 配置界面。

---

## 一、一键安装

```sh
curl -fsSL "https://raw.githubusercontent.com/498777/luci-app-honk/main/Auto_Install_Script.sh" | sh -s luci-app-honk
```

> 默认分支为 `master` 时，URL 中的 `main` 需一并替换。

脚本行为：

1. 检测 `apk`（非 apk 体系直接退出，不静默降级）；
2. 读取 `apk --print-arch` 得到架构（`x86_64` / `aarch64`）；
3. 调 GitHub API 取 Release 里的 `.apk`，按名称与架构自动匹配 `honk`、`luci-app-honk`、`luci-i18n-honk-zh-cn`；
4. **若包内仍声明了 `vmlinux-btf`**（例如指向上游的包），会解开 apk、从 `.PKGINFO` 的 `depend` 中删除该依赖、重新打包再安装 —— apk 数据库不会留下未满足依赖；
5. 清 LuCI 缓存、重启 `rpcd` / `uhttpd`。

常用参数：

```sh
# 临时指定其他仓库
curl -fsSL .../Auto_Install_Script.sh | sh -s -- --repo someone/luci-app-honk

# 只装主程序，不装 LuCI
curl -fsSL .../Auto_Install_Script.sh | sh -s honk

# 不做去依赖处理，原样安装（适用于确实需要 vmlinux-btf 的固件）
curl -fsSL .../Auto_Install_Script.sh | sh -s -- --keep-dep
```

安装完成后启用服务：

```sh
uci set honk.config.enabled=1
uci commit honk
/etc/init.d/honk start
```

LuCI 入口在 **服务 → HONK**。首次使用前需将 `/etc/honk/config.d/node.dae` 中的示例节点/订阅替换为实际配置。

---

## 二、关于 vmlinux-btf

honk 是 eBPF CO-RE 程序，加载时**必须有 BTF 信息**，BTF 只有两个来源：

1. 内核自带：`/sys/kernel/btf/vmlinux`（内核开启 `CONFIG_DEBUG_INFO_BTF`）—— **本仓库采用此方式**；
2. `vmlinux-btf` 包：额外下载一份 BTF 文件，体积大，且版本可能与运行中的内核不一致。

上游将 `+HONK_USE_VMLINUX_BTF:vmlinux-btf` 作为 menuconfig 可选项；本仓库直接从 `honk/Makefile` 的 `DEPENDS` 中删除，同时移除对应的 `Package/honk/config` choice 块。因此：

- 编出的 apk 的 `.PKGINFO` 中**不会**出现 `depend = vmlinux-btf`；
- `apk add` 时不会再拉入几 MB 的 BTF 包；
- 编译期的 `Assert no vmlinux-btf dependency` 步骤做兜底检查，一旦依赖被改回，CI 直接失败，不会发布。

⚠️ 代价是：**内核未开启 `CONFIG_DEBUG_INFO_BTF` 时，honk 可安装但无法启动。** 安装脚本会检查 `/sys/kernel/btf/vmlinux` 并给出提示。官方 24.10+ 的 x86_64 / armsr 默认配置均带 BTF，自编译固件需开启该选项。

---

## 三、在自建仓库中复刻本套流程

1. 新建 GitHub 仓库（默认分支 `main`），将本目录内容推送至该仓库。
2. 修改 `Auto_Install_Script.sh` 顶部的仓库地址：

   ```sh
   REPO="${REPO:-YOUR_OWNER/YOUR_REPO}"   # ← 目标仓库的 OWNER/REPO
   ```

3. 推送后，在 **Actions → Build apk → Run workflow** 执行一次（SDK 默认 `openwrt-25.12`，可改为其他 apk 版本）。
4. 完成后 Release 中生成 `honk_<version>`，附件形如：

   ```
   honk-0.0.1_beta74-r2-x86_64.apk
   honk-0.0.1_beta74-r2-aarch64_generic.apk
   luci-app-honk-1.0.0-r4-x86_64.apk
   luci-app-honk-1.0.0-r4-aarch64.apk
   luci-i18n-honk-zh-cn-1.0.0-r4-x86_64.apk
   luci-i18n-honk-zh-cn-1.0.0-r4-aarch64.apk
   ```

   随后即可使用第一节的安装命令。

5. （可选）`Update honk version` 工作流每日同步上游版本，有更新时自动提交并触发编译。

> 默认只编译 `honk` 与 `luci-app-honk`。需要中文语言包时，在 workflow_dispatch 的
> `packages` 输入框中加上 `luci-i18n-honk-zh-cn` —— 该包在部分 SDK 的 luci feeds 中
> 不存在，写入 `PACKAGES` 会导致 `make package/<pkg>/download` 报
> `No rule to make target` 而中断编译。

---

## 四、在 OpenWrt 源码树中编译

```sh
git clone https://github.com/498777/luci-app-honk package/honk
./scripts/feeds update -a
./scripts/feeds install -a
make menuconfig   # Network -> Web Servers/Proxies -> luci-app-honk
make package/honk/compile V=s
```

产物位于 `bin/packages/<arch>/`。此方式下无需 `Auto_Install_Script.sh`，直接使用 `apk add` 安装。

honk 只提供 `x86_64` 与 `aarch64` 的静态 musl 二进制，包通过 `@(x86_64||aarch64)` 限制架构。

---

## 五、目录说明

```
Auto_Install_Script.sh             一键安装脚本（apk）
honk/                              核心包：下载预编译 honk-core + 配置/启动脚本
luci-app-honk/                     LuCI 界面（controller / cbi / view / po）
scripts/update_honk_version.sh     同步上游版本与 sha256
.github/workflows/build-apk.yml    用 OpenWrt SDK 编 apk 并发布 Release
.github/workflows/update-honk.yml  每日同步上游版本
```

配置路径：`/etc/honk/config.dae`，拆分配置 `/etc/honk/config.d/{node,route,dns}.dae`。

---

## 六、启动脚本 & 日志

`honk/files/honk.init` 相对上游做了两处调整：

1. **新增日志轮转**：每次启动会 `mkdir -p /var/log/honk`，将现有 `honk.log` 依次
   轮转为 `honk.log.1 → .2 → .3`（最多保留 3 份，更老的丢弃），再新建一个空的
   `honk.log`（权限 640，目录 755）。该文件即 LuCI 日志页
   `admin/services/honk/get_log` 读取的对象（`tail -n 1000 /var/log/honk/honk.log`），
   上游 init 从不创建它，因此日志页原本始终为空。
2. **去掉 `/tmp/resolv.conf` 劫持**：删除上游的 `hijack_resolv_conf()` /
   `restore_resolv_conf()`，不再 bind-mount 覆盖 `/tmp/resolv.conf`。
   如需 honk 接管本机 DNS，需恢复该逻辑或另行处理 resolv.conf。

其余保持不变：启动时清理 `dae0` / `dae0peer` / `daens` 残留，procd 托管并 respawn，
`hot_reload` 走 `honk-core reload`。

---

## 七、许可证

本仓库采用 **AGPL-3.0-only**（[LICENSE](./LICENSE)），与 `honk/Makefile` 中已声明的
`PKG_LICENSE:=AGPL-3.0-only` 保持一致。

背景：

| 组成部分 | 上游许可证 |
| --- | --- |
| `honk-core` 二进制 | [daeuniverse/honk](https://github.com/daeuniverse/honk) 的 LICENSE 文件是 **GPL-3.0** 文本 |
| dae（honk 的源头） | [daeuniverse/dae](https://github.com/daeuniverse/dae) 为 **AGPL-3.0** |
| `luci-app-honk` LuCI 部分 | QiuSimons/luci-app-honk **未声明任何许可证**；`luci-app-honk/Makefile` 头部沿用了 OpenWrt luci.mk 的 Apache-2.0 模板注释 |

选择 AGPL-3.0 的原因：

1. 与 Makefile 中已有的 `PKG_LICENSE:=AGPL-3.0-only` 对齐，不会出现「声明与实际不符」；
2. 与 dae / luci-app-dae 一脉保持一致（LuCI 界面本就参照 luci-app-dae 实现）；
3. GPL-3.0 第 13 条明确允许将 GPLv3 代码合并进 AGPLv3 作品，因此即便 honk 实际为
   GPL-3.0，整体采用 AGPL-3.0 也无兼容性问题（反向则不行）。

改用 GPL-3.0 时：替换根目录的 `LICENSE`，并将 `honk/Makefile` 中的
`PKG_LICENSE:=AGPL-3.0-only` 改为 `GPL-3.0-only`（两处需同时修改）。

⚠️ 需注意：fork 源 `QiuSimons/luci-app-honk` 无许可证，严格来说其代码默认
「保留所有权利」。个人或自用场景通常不受影响；长期公开发布的情况，建议向上游
提出补充 LICENSE 的请求，或将本仓库的改动部分单独声明。
