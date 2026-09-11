#!/bin/sh

REPO="${REPO:-498777/luci-app-honk}"
STRIP_DEPS="vmlinux-btf"
LANGS="zh-cn zh_Hans zh_cn"
FORCE=0
GH_PROXY="${GH_PROXY:-https://ghfast.top}"
TMPDIR_WORK="${TMPDIR:-/tmp}/honk-install.$$"
PLANFILE="/tmp/honk-plan.$$"
APKREPO="${TMPDIR:-/tmp}/apkrepo.$$"
DECIDED="/tmp/honk-decide.$$"
PKGS=""

# 自愈：清理 /etc/apk/world 中遗留的 /tmp 路径条目（旧版脚本安装留下的）
if [ -f /etc/apk/world ] && grep -q '/tmp/' /etc/apk/world 2>/dev/null; then
    sed -i '/\/tmp\//d' /etc/apk/world
    echo "ℹ 已清理 /etc/apk/world 中的 /tmp 悬空条目"
fi

usage() {
    cat <<'EOF'
用法：
  curl -fsSL "https://raw.githubusercontent.com/<OWNER>/<REPO>/main/Auto_Install_Script.sh" | sh -s luci-app-honk

参数：
  --repo <OWNER/REPO>   指定 Release 所在仓库（也可 export REPO=... 后运行）
  --repo=<OWNER/REPO>   同上
  --force               版本相同时也强制重装
  --no-proxy            关闭 GitHub 加速，直连下载
  --gh-proxy [URL]      指定 GitHub 加速前缀（默认 https://ghfast.top；也可 export GH_PROXY=...）
  --keep-dep            不剔除 vmlinux-btf 依赖，原样安装
  -h, --help            显示本帮助
  <包名>...             指定要装的包，留空则装 honk + luci-app-honk + 中文语言包
                        （指定 luci-app-honk 时会自动补上 honk 与中文语言包）

示例：
  curl -fsSL .../Auto_Install_Script.sh | sh -s
  curl -fsSL .../Auto_Install_Script.sh | sh -s honk
  curl -fsSL .../Auto_Install_Script.sh | sh -s -- --force
EOF
    exit 0
}

die() { echo "✗ $*"; exit 1; }
info() { echo "→ $*"; }
ok() { echo "✓ $*"; }

# GitHub 加速前缀（默认 ghfast.top，--no-proxy 或 GH_PROXY= 关闭）
gurl() {
    if [ -n "$GH_PROXY" ]; then
        printf '%s/%s' "${GH_PROXY%/}" "$1"
    else
        printf '%s' "$1"
    fi
}

while [ $# -gt 0 ]; do
    case "$1" in
        --repo|-r)     REPO="$2"; shift 2 ;;
        --repo=*)      REPO="${1#--repo=}"; shift ;;
        --force)       FORCE=1; shift ;;
        --no-proxy)    GH_PROXY=""; shift ;;
        --gh-proxy)    GH_PROXY="${2:-https://ghfast.top}"; shift 2 ;;
        --gh-proxy=*)  GH_PROXY="${1#--gh-proxy=}"; shift ;;
        --keep-dep)    STRIP_DEPS=""; shift ;;
        -h|--help)     usage ;;
        *)             PKGS="$PKGS $1"; shift ;;
    esac
done

echo "╔══════════════════════════════════════════════╗"
echo "║   luci-app-honk 一键安装（apk）              ║"
echo "╚══════════════════════════════════════════════╝"

case "$REPO" in
    ""|YOUR_OWNER/YOUR_REPO)
        die "未设置仓库。请把脚本里的 REPO 改成你的仓库，或这样运行：
     curl -fsSL .../Auto_Install_Script.sh | sh -s -- --repo OWNER/REPO luci-app-honk" ;;
esac
echo "仓库: https://github.com/$REPO"

command -v curl >/dev/null 2>&1 || die "缺少 curl，请先安装：apk add curl"
command -v apk  >/dev/null 2>&1 || die "未检测到 apk。本仓库只发布 apk 包，请使用 OpenWrt 24.10+ / 25.x 的 apk 体系固件。"

ARCH=$(apk --print-arch 2>/dev/null)
[ -n "$ARCH" ] || die "无法获取系统架构（apk --print-arch 失败）"
echo "架构: $ARCH"

if [ ! -f /sys/kernel/btf/vmlinux ]; then
    echo "⚠ 未发现 /sys/kernel/btf/vmlinux：当前内核可能未开启 CONFIG_DEBUG_INFO_BTF。"
    echo "  honk 仍能装上，但无法启动。请换用带 BTF 的内核（如官方 24.10+ 默认配置）。"
fi

# ------------------------------------------------- 获取最新 Release（不走 GitHub API，避免 403）
info "查询最新 Release ..."

get_latest_tag() {
    loc=$(curl -fsSI --max-time 20 "$(gurl "https://github.com/$REPO/releases/latest")" 2>/dev/null \
        | tr -d '\r' | sed -n 's#^[Ll]ocation: .*/releases/tag/##p')
    if [ -z "$loc" ]; then
        page=$(curl -fsSL --max-time 30 "$(gurl "https://github.com/$REPO/releases")" 2>/dev/null)
        loc=$(printf '%s' "$page" | grep -oE '/releases/tag/[^"?]+' | head -1 | sed 's#.*/tag/##')
    fi
    [ -n "$loc" ] || return 1
    printf '%s' "$loc"
}

list_assets() {
    tag="$1"
    curl -fsSL --max-time 30 "$(gurl "https://github.com/$REPO/releases/expanded_assets/$tag")" 2>/dev/null \
        | grep -oE "href=\"/$REPO/releases/download/$tag/[^\"]+\.apk\"" \
        | sed "s#^href=\"/#https://github.com/#; s#\"\$##" | sort -u
}

TAG=$(get_latest_tag) || die "获取 Release 失败，请检查网络或仓库名是否正确"
echo "最新版本: $TAG"
URLS=$(list_assets "$TAG")
[ -n "$URLS" ] || die "Release $TAG 中没有找到 .apk 文件"

# ----------------------------------------------------------- 版本工具
strip_arch_suffix() {
    v="$1"
    for a in "$ARCH" x86_64 x86_64v3 aarch64 aarch64_generic all noarch; do
        case "$v" in *"-$a") v="${v%-$a}" ;; esac
    done
    printf '%s' "$v"
}

asset_ver() {
    f=$(basename "$1")
    n="$2"
    f=${f%.apk}
    v=${f#"$n"-}
    strip_arch_suffix "$v"
}

apk_installed_ver() {
    apk list --installed 2>/dev/null | awk -v p="$1-" -v a="$ARCH" '
        $1 ~ "^" p {
            v=$1; sub("^" p, "", v)
            if (v ~ ("-" a "$")) v=substr(v,1,length(v)-length(a)-1)
            n=split("x86_64 x86_64v3 aarch64 aarch64_generic all noarch", ar, " ")
            for (i=1;i<=n;i++) if (v ~ ("-" ar[i] "$")) { v=substr(v,1,length(v)-length(ar[i])-1); break }
            print v; exit
        }'
}

# --------------------------------------------------------- 挑选包（写入 PLANFILE：每行 "URL|包名"）
select_pkg() {
    cands=$(echo "$URLS" | grep -E "/${1}[-_][^\"/]*\.apk$")
    [ -n "$cands" ] || return 1
    best=$(echo "$cands" | grep -i -- "$ARCH" | head -1)
    [ -z "$best" ] && best=$(echo "$cands" | grep -Ei '[-_](all|noarch)[-_.]' | head -1)
    [ -z "$best" ] && best=$(echo "$cands" | head -1)
    echo "$best"
}

plan_has() {
    grep -q "^[^|]*|$1$" "$PLANFILE" 2>/dev/null
}

add_pkg() {
    u=$(select_pkg "$1") || u=""
    if [ -n "$u" ]; then
        echo "$u|$1" >> "$PLANFILE"
    else
        echo "⚠ 未找到 $1 的 apk，跳过"
        return 1
    fi
}

add_i18n() {
    for lang in $LANGS; do
        u=$(select_pkg "luci-i18n-honk-${lang}") || u=""
        if [ -n "$u" ]; then echo "$u|luci-i18n-honk-${lang}" >> "$PLANFILE"; return 0; fi
    done
    echo "⚠ 未找到中文语言包，界面将是英文"
    return 1
}

# --------------------------------------------- 拆包剔除依赖后重新打包
strip_apk_dep() {
    f="$1"
    [ -n "$STRIP_DEPS" ] || return 0
    [ -f "$f" ] || return 1

    rm -rf "$TMPDIR_WORK"; mkdir -p "$TMPDIR_WORK" || return 1

    gzip -dc "$f" > "$TMPDIR_WORK/all.tar" 2>/dev/null || { rm -rf "$TMPDIR_WORK"; return 1; }
    tar -xOf "$TMPDIR_WORK/all.tar" .PKGINFO > "$TMPDIR_WORK/.PKGINFO" 2>/dev/null || {
        rm -rf "$TMPDIR_WORK"; return 1; }

    need=0
    for d in $STRIP_DEPS; do
        grep -q "^depend = ${d}\$" "$TMPDIR_WORK/.PKGINFO" && need=1
    done
    if [ "$need" -eq 0 ]; then
        rm -rf "$TMPDIR_WORK"; return 0
    fi
    echo "  ⚙ 检测到依赖 $STRIP_DEPS，拆包剔除后重新打包 ..."

    allsize=$(wc -c < "$TMPDIR_WORK/all.tar" | tr -d ' ')
    off=""
    if [ 10240 -lt "$allsize" ] &&
       tail -c +10241 "$TMPDIR_WORK/all.tar" | tar -tf - >/dev/null 2>&1; then
        off=10240
    else
        o=512
        while [ "$o" -le 20480 ] && [ "$o" -lt "$allsize" ]; do
            if tail -c +$((o + 1)) "$TMPDIR_WORK/all.tar" | tar -tf - >/dev/null 2>&1; then
                off=$o; break
            fi
            o=$((o + 512))
        done
    fi
    if [ -z "$off" ]; then
        rm -rf "$TMPDIR_WORK"
        echo "  ⚠ 无法定位数据段，跳过剔除"
        return 1
    fi

    for d in $STRIP_DEPS; do
        sed -i "/^depend = ${d}\$/d" "$TMPDIR_WORK/.PKGINFO"
    done

    ( cd "$TMPDIR_WORK" && tar -cf control.tar .PKGINFO ) || { rm -rf "$TMPDIR_WORK"; return 1; }
    tail -c +$((off + 1)) "$TMPDIR_WORK/all.tar" > "$TMPDIR_WORK/data.tar" || {
        rm -rf "$TMPDIR_WORK"; return 1; }

    gzip -c "$TMPDIR_WORK/control.tar" > "$f.new" &&
    gzip -c "$TMPDIR_WORK/data.tar"   >> "$f.new" &&
    mv "$f.new" "$f" || { rm -f "$f.new"; rm -rf "$TMPDIR_WORK"; return 1; }

    rm -rf "$TMPDIR_WORK"
    ok "已剔除 $STRIP_DEPS"
    return 0
}

pkg_name_of() {
    gzip -dc "$1" 2>/dev/null | tar -xO .PKGINFO 2>/dev/null | sed -n 's/^name = //p' | head -n 1
}

# 本地 apk 建索引后按包名安装（避免把 /tmp 路径写进 /etc/apk/world）
install_local_apk() {
    f="$1"
    [ -f "$f" ] || return 1
    name=$(pkg_name_of "$f")
    [ -n "$name" ] || { echo "✗ 无法读取包名：$f"; return 1; }
    mkdir -p "$APKREPO"
    mv -f "$f" "$APKREPO/$(basename "$f")" || return 1
    ( cd "$APKREPO" && apk index -o APKINDEX.tar.gz ./*.apk >/dev/null 2>&1 ) \
      || ( cd "$APKREPO" && apk index --allow-untrusted -o APKINDEX.tar.gz ./*.apk >/dev/null 2>&1 )
    if apk add --allow-untrusted --repository "$APKREPO" --no-network "$name"; then
        :
    else
        echo "  ⚠ 常规安装失败，尝试 --force-broken-world"
        apk add --allow-untrusted --force-broken-world --repository "$APKREPO" --no-network "$name" \
          || { echo "✗ 安装失败"; return 1; }
    fi
    ok "$name 安装完成"
    return 0
}

install_url() {
    url="$1"
    [ -n "$url" ] || return 1
    file=$(basename "$url")
    info "下载 $file"
    curl -fsSL --max-time 300 --retry 2 -o "/tmp/$file" "$(gurl "$url")" || { echo "✗ 下载失败"; return 1; }

    strip_apk_dep "/tmp/$file"

    echo "  ⬇ 安装 $file"
    install_local_apk "/tmp/$file" || { rm -f "/tmp/$file"; return 1; }
    return 0
}

# --------------------------------------------------------- 计算待装清单
: > "$PLANFILE"; : > "$DECIDED"

add_pkg_nodup() {
    plan_has "$1" && return 0
    add_pkg "$1"
}

if [ -n "$PKGS" ]; then
    want_luci=0
    for p in $PKGS; do
        [ "$p" = "luci-app-honk" ] && want_luci=1
    done
    if [ "$want_luci" -eq 1 ]; then
        add_pkg_nodup honk
    fi
    for p in $PKGS; do
        add_pkg_nodup "$p"
    done
    if [ "$want_luci" -eq 1 ]; then
        add_pkg_nodup luci-app-honk
        add_i18n
    fi
else
    add_pkg honk
    add_pkg luci-app-honk
    add_i18n
fi

if [ ! -s "$PLANFILE" ]; then die "没有可安装的包"; fi

echo ""
echo "版本检查："
echo "  本地已装  vs  最新 Release"
while IFS='|' read -r u n; do
    [ -n "$u" ] || continue
    newv=$(asset_ver "$u" "$n")
    oldv=$(apk_installed_ver "$n")
    if [ -n "$oldv" ] && [ "$oldv" = "$newv" ] && [ "$FORCE" -eq 0 ]; then
        echo "  · $n  $oldv == $newv  已是最新，跳过"
    else
        echo "  · $n  ${oldv:-未安装} → $newv"
        echo "$u|$n" >> "$DECIDED"
    fi
done < "$PLANFILE"
echo ""

if [ ! -s "$DECIDED" ]; then
    echo "✅ 所有包已是最新版本，无需操作（--force 可强制重装）"
    rm -f "$PLANFILE" "$DECIDED"
rm -rf "$APKREPO"
    exit 0
fi

echo "即将安装："
while IFS='|' read -r u n; do echo "  · $(basename "$u")"; done < "$DECIDED"
echo ""

FAILED=""
while IFS='|' read -r u n; do
    install_url "$u" || FAILED="$FAILED $(basename "$u")"
done < "$DECIDED"
rm -f "$PLANFILE" "$DECIDED"

echo ""
info "刷新 LuCI 缓存 ..."
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null
/etc/init.d/rpcd restart    >/dev/null 2>&1
/etc/init.d/uhttpd restart  >/dev/null 2>&1

echo ""
info "为 honk 建立 geo 软链 ..."
mkdir -p /usr/share/honk
geo_linked=0
for gf in geoip.dat geosite.dat; do
    if [ -f "/usr/share/v2ray/$gf" ]; then
        ln -sf "/usr/share/v2ray/$gf" "/usr/share/honk/$gf"
        geo_linked=1
    fi
done
if [ "$geo_linked" -eq 1 ]; then
    ok "已在 /usr/share/honk 建立 geo 软链"
else
    echo "⚠ 未发现 /usr/share/v2ray 下的 geo 数据；若规则用到 geoip:/geosite:，"
    echo "  需自行安装官方包（apk add v2ray-geoip v2ray-geosite），再重跑本脚本即可建链。"
fi

echo ""
if [ -n "$FAILED" ]; then
    echo "✗ 以下包安装失败：$FAILED"
    exit 1
fi
echo "✅ 完成！"
echo ""
echo "下一步："
echo "  1. LuCI 界面：服务 → HONK（若看不到请清浏览器缓存或重新登录）"
echo "  2. 命令行启用：uci set honk.config.enabled=1; uci commit honk; /etc/init.d/honk start"
echo "  3. geo 软链已自动建立在 /usr/share/honk"
echo "     若提示缺少 geo 数据，请先 apk add v2ray-geoip v2ray-geosite 再重跑本脚本"
echo "  4. 首次使用请先在 Node Settings 页签（或 /etc/honk/config.d/node.dae）"
echo "     把示例节点/订阅替换成自己的，再启用服务，否则 honk 会拒绝启动"
