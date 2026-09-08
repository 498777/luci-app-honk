# Copyright (C) 2016 Openwrt.org

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-honk
PKG_VERSION:=1.0.0
PKG_RELEASE:=6

LUCI_TITLE:=LuCI support for honk
LUCI_PKGARCH:=all
LUCI_DEPENDS:=+honk +luci-compat

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
