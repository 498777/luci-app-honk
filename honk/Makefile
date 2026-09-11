# SPDX-License-Identifier: GPL-2.0-only

include $(TOPDIR)/rules.mk

PKG_NAME:=honk
PKG_VERSION:=0.0.1_beta76
PKG_RELEASE:=1

HONK_RELEASE_TAG:=v0.0.1.beta.76

HONK_HASH_X86_64:=02edafab5741cacd62c00d0a249df768506db34f7dfb58ce6f150307a57fdfc6
HONK_HASH_AARCH64:=d2c1848640d52b79e4d8121291b6cccbe45349256d77218f8fc4a270f36afc8f

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
  DEPENDS:=@(x86_64||aarch64) \
    +ca-bundle +ip-full \
    +kmod-sched-core +kmod-sched-bpf +kmod-veth +kmod-nft-queue \
    +v2ray-geoip +v2ray-geosite \
    +@KERNEL_XDP_SOCKETS
endef

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
