# SPDX-License-Identifier: GPL-2.0-only

include $(TOPDIR)/rules.mk

PKG_NAME:=honk
PKG_VERSION:=0.0.1_beta74
PKG_RELEASE:=2

# Raw upstream release tag. It keeps the dots in qualifiers (e.g. v0.0.1.beta.49)
# because that is what the GitHub release asset name uses.
HONK_RELEASE_TAG:=v0.0.1.beta.74

# SHA256 of each release tarball, kept in sync by scripts/update_honk_version.sh.
HONK_HASH_X86_64:=38260a6c8b3257e432c8de96cadbc2bc1bb3a785dafd7503284500602a306d56
HONK_HASH_AARCH64:=a46b3e6a6e9499e4c14a5cbea6bc756f616b51973fa785376e21b13720cdc935

PKG_LICENSE:=AGPL-3.0-only
PKG_LICENSE_FILE:=LICENSE
PKG_MAINTAINER:=luci-app-honk maintainers

ifeq ($(ARCH),x86_64)
  HONK_TARGET:=x86_64-unknown-linux-musl
  HONK_HASH:=$(HONK_HASH_X86_64)
else ifeq ($(ARCH),aarch64)
  HONK_TARGET:=aarch64-unknown-linux-musl
  HONK_HASH:=$(HONK_HASH_AARCH64)
endif

# Default to the stock-malloc build: lower RSS high-water on small gateways.
# Use an empty suffix to switch back to the mimalloc build (faster QUIC).
HONK_SUFFIX:=-stock
HONK_ASSET:=honk-core-$(HONK_RELEASE_TAG)-$(HONK_TARGET)$(HONK_SUFFIX).tar.gz

PKG_SOURCE:=$(HONK_ASSET)
PKG_SOURCE_URL:=https://github.com/daeuniverse/honk/releases/download/$(HONK_RELEASE_TAG)/
PKG_HASH:=$(HONK_HASH)

include $(INCLUDE_DIR)/package.mk

define Package/honk
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=honk - eBPF transparent proxy engine (dae-compatible)
  URL:=https://github.com/daeuniverse/honk
  # 注意：本分支移除了上游的 `+HONK_USE_VMLINUX_BTF:vmlinux-btf` 条件依赖。
  # honk 是 eBPF CO-RE 程序，运行时必须有 BTF 信息，且**只能**来自内核自带的
  # /sys/kernel/btf/vmlinux（内核需开启 CONFIG_DEBUG_INFO_BTF）。
  # 不再引入 vmlinux-btf 包，以免安装时被 opkg/apk 强行拉入一个体积大、
  # 且与当前内核版本不匹配的 BTF 文件。
  DEPENDS:=@(x86_64||aarch64) \
    +ca-bundle +ip-full \
    +kmod-sched-core +kmod-sched-bpf +kmod-veth +kmod-nft-queue \
    +v2ray-geoip +v2ray-geosite \
    +@KERNEL_XDP_SOCKETS
endef

# 上游的 Package/honk/config 用于选择 BTF 来源（内核自带 / vmlinux-btf 包）。
# 这里固定走内核自带 BTF，因此整个 choice 块已删除。

define Package/honk/conffiles
/etc/honk/
/etc/config/honk
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(TAR) -xzf $(DL_DIR)/$(PKG_SOURCE) -C $(PKG_BUILD_DIR) --strip-components=1
endef

define Build/Compile
	true
endef

define Package/honk/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/honk-core $(1)/usr/bin/honk-core

	$(INSTALL_DIR) $(1)/etc/honk/config.d
	$(INSTALL_CONF) $(CURDIR)/files/config.dae $(1)/etc/honk/config.dae
	$(INSTALL_CONF) $(CURDIR)/files/config.d/node.dae $(1)/etc/honk/config.d/node.dae
	$(INSTALL_CONF) $(CURDIR)/files/config.d/route.dae $(1)/etc/honk/config.d/route.dae
	$(INSTALL_CONF) $(CURDIR)/files/config.d/dns.dae $(1)/etc/honk/config.d/dns.dae

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) $(CURDIR)/files/honk.config $(1)/etc/config/honk

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(CURDIR)/files/honk.init $(1)/etc/init.d/honk
endef

$(eval $(call BuildPackage,honk))
