# luci-app-honk（自建仓库 · 仅 apk · 无 vmlinux-btf 依赖）

> **License: AGPL-3.0-only**，完整文本见 [LICENSE](./LICENSE)。
> 本仓库 fork 自 [QiuSimons/luci-app-honk](https://github.com/QiuSimons/luci-app-honk)（该仓库未声明许可证）。

OpenWrt 上 [honk](https://github.com/daeuniverse/honk)（eBPF 透明代理引擎，dae 兼容）的 LuCI 界面与二进制包。

本仓库 fork 自 [QiuSimons/luci-app-honk](https://github.com/QiuSimons/luci-app-honk)，并做了两处调整：

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

> 如果默认分支是 `master`，把 URL 里的 `main` 一起改掉。

脚本行为：

1. 检测 `apk`（不是 apk 体系会直接退出，不静默降级）；
2. 读取 `apk --print-arch` 得到架构（`x86_64` / `aarch64`）；
3. 调 GitHub API 取 Release 里的 `.apk`，按名字+架构自动匹配 `honk`、`luci-app-honk`、`luci-i18n-honk-zh-cn`；
4. **若包里仍声明了 `vmlinux-btf`**（比如指到了上游的包），会解开 apk、从 `.PKGINFO` 的 `depend` 里删掉它、重新打包再安装 —— apk 数据库里不会留下未满足依赖；
5. 清 LuCI 缓存、重启 `rpcd` / `uhttpd`。

常用参数：

```sh
# 临时指定别的仓库
curl -fsSL .../Auto_Install_Script.sh | sh -s -- --repo someone/luci-app-honk

# 只装主程序，不装 LuCI
curl -fsSL .../Auto_Install_Script.sh | sh -s honk

# 不做去依赖处理，原样安装（例如你的固件确实需要 vmlinux-btf）
curl -fsSL .../Auto_Install_Script.sh | sh -s -- --keep-dep
```

安装完成后：

```sh
uci set honk.config.enabled=1
uci commit honk
/etc/init.d/honk start
```

LuCI 入口在 **服务 → honk**。首次使用前记得把 `/etc/honk/config.d/node.dae` 里的示例节点/订阅换成自己的。

---

## 二、关于 vmlinux-btf

honk 是 eBPF CO-RE 程序，加载时**必须有 BTF 信息**，BTF 只有两个来源：

1. 内核自带：`/sys/kernel/btf/vmlinux`（内核开启 `CONFIG_DEBUG_INFO_BTF`）—— **本仓库走这条路**；
2. `vmlinux-btf` 包：额外下载一份 BTF 文件，体积大，且版本很可能和运行中的内核不一致。

上游把 `+HONK_USE_VMLINUX_BTF:vmlinux-btf` 作为 menuconfig 可选项；这里直接从 `honk/Makefile` 的 `DEPENDS` 删掉了，同时删除了对应的 `Package/honk/config` choice 块。因此：

- 编出来的 apk 的 `.PKGINFO` 里**不会**出现 `depend = vmlinux-btf`；
- `apk add` 时不会再被拉一个几 MB 的 BTF 包；
- 编译期的 `Assert no vmlinux-btf dependency` 步骤会兜底检查，万一有人把依赖改回来，CI 会直接失败，不会发布。

⚠️ 代价是：**如果内核没开 `CONFIG_DEBUG_INFO_BTF`，honk 装得上但起不来。** 安装脚本会检查 `/sys/kernel/btf/vmlinux` 并给出提示。官方 24.10+ 的 x86_64 / armsr 默认配置都带 BTF，自编译固件的话注意勾上。

---

## 三、自建仓库步骤

1. 在 GitHub 新建仓库（建议同名 `luci-app-honk`，默认分支 `main`），把本目录内容推上去。
2. 修改 `Auto_Install_Script.sh` 顶部的仓库地址：

   ```sh
   REPO="${REPO:-YOUR_OWNER/YOUR_REPO}"   # ← 改成你的 OWNER/REPO
   ```

3. 推到 GitHub 后，到 **Actions → Build apk → Run workflow** 手动跑一次（SDK 默认 `openwrt-25.12`，可在输入框改成别的 apk 版本）。
4. 跑完会在 Release 里生成 `honk_<version>`，附件形如：

   ```
   honk-0.0.1_beta74-r1-x86_64.apk
   honk-0.0.1_beta74-r1-aarch64_generic.apk
   luci-app-honk-1.0.0-r2-x86_64.apk
   luci-app-honk-1.0.0-r2-aarch64.apk
   luci-i18n-honk-zh-cn-1.0.0-r2-x86_64.apk
   luci-i18n-honk-zh-cn-1.0.0-r2-aarch64.apk
   ```

   之后即可用第一节的一键命令安装。

5. （可选）`Update honk version` 工作流每天自动跟上游版本，有更新会提交并触发编译。

> 如果 `luci-i18n-honk-zh-cn` 在你的 feeds 里不存在导致编译报错，把它从 `.github/workflows/build-apk.yml` 的 `PACKAGES` 里删掉即可。

---

## 四、在自己的 OpenWrt 源码树里编译

```sh
git clone https://github.com/498777/luci-app-honk package/honk
./scripts/feeds update -a
./scripts/feeds install -a
make menuconfig   # Network -> Web Servers/Proxies -> luci-app-honk
make package/honk/compile V=s
```

产物在 `bin/packages/<arch>/` 下。此时不需要 `Auto_Install_Script.sh`，直接用 `apk add` 装即可。

honk 只提供 `x86_64` 与 `aarch64` 的静态 musl 二进制，包通过 `@(x86_64||aarch64)` 限制架构。

---

## 五、目录说明

```
Auto_Install_Script.sh      一键安装脚本（apk）
honk/                       核心包：下载预编译 honk-core + 配置/启动脚本
luci-app-honk/              LuCI 界面（controller / cbi / view / po）
scripts/update_honk_version.sh   跟上游版本与 sha256
.github/workflows/build-apk.yml  用 OpenWrt SDK 编 apk 并发布 Release
.github/workflows/update-honk.yml 每日同步上游版本
```

配置路径：`/etc/honk/config.dae`，拆分配置 `/etc/honk/config.d/{node,route,dns}.dae`。

## 六、启动脚本 & 日志

`honk/files/honk.init` 相比上游做了两处调整：

1. **新增日志轮转**：每次启动会 `mkdir -p /var/log/honk`，把现有 `honk.log` 依次
   轮转为 `honk.log.1 → .2 → .3`（最多保留 3 份，更老的丢弃），再新建一个空的
   `honk.log`（权限 640）。这正是 LuCI 日志页 `admin/services/honk/get_log`
   读取的文件（`tail -n 1000 /var/log/honk/honk.log`），上游 init 从不创建它，
   所以日志页一直是空的。
2. **去掉 `/tmp/resolv.conf` 劫持**：删除了上游的 `hijack_resolv_conf()` /
   `restore_resolv_conf()`，不再 bind-mount 覆盖 `/tmp/resolv.conf`。
   如果你依赖 honk 接管本机 DNS，需要改回去或自行处理 resolv.conf。

其他保持不变：启动时清理 `dae0` / `dae0peer` / `daens` 残留，procd 托管并 respawn，
`hot_reload` 走 `honk-core reload`。

## 七、许可证

本仓库采用 **AGPL-3.0-only**（[LICENSE](./LICENSE)），与 `honk/Makefile` 里已声明的
`PKG_LICENSE:=AGPL-3.0-only` 保持一致。

背景，供你自己判断要不要改：

| 组成部分 | 上游许可证 |
| --- | --- |
| `honk-core` 二进制 | [daeuniverse/honk](https://github.com/daeuniverse/honk) 的 LICENSE 文件是 **GPL-3.0** 文本 |
| dae（honk 的源头） | [daeuniverse/dae](https://github.com/daeuniverse/dae) 为 **AGPL-3.0** |
| `luci-app-honk` LuCI 部分 | QiuSimons/luci-app-honk **未声明任何许可证**；`luci-app-honk/Makefile` 头部沿用了 OpenWrt luci.mk 的 Apache-2.0 模板注释 |

选 AGPL-3.0 的原因：

1. 与 Makefile 里已有的 `PKG_LICENSE:=AGPL-3.0-only` 对齐，不会出现「声明与实际不符」；
2. 与 dae / luci-app-dae 这一脉保持一致（LuCI 界面本就是照着 luci-app-dae 写的）；
3. GPL-3.0 第 13 条明确允许把 GPLv3 代码合并进 AGPLv3 作品，所以即便 honk 实际是
   GPL-3.0，整体采用 AGPL-3.0 也没有兼容性问题（反过来则不行）。

想换成 GPL-3.0 的话，替换根目录下的 `LICENSE`，并把 `honk/Makefile` 的
`PKG_LICENSE:=AGPL-3.0-only` 改成 `GPL-3.0-only` 即可（两处必须同时改）。

⚠️ 一点提醒：fork 源 `QiuSimons/luci-app-honk` 没有许可证，严格来说其代码默认
「保留所有权利」。个人或自用场景通常没人追究，但如果你打算长期公开发布，建议去
上游提个 issue 请作者补一个 LICENSE，或者把本仓库的改动部分单独声明清楚。
