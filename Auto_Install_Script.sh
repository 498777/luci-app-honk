#!/bin/sh
# ============================================================================
#  Auto_Install_Script.sh —— 从本仓库 Release 安装 luci-app-honk（仅 apk 包）
#
#  用法：
#    curl -fsSL "https://raw.githubusercontent.com/<OWNER>/<REPO>/main/Auto_Install_Script.sh" \
#      | sh -s luci-app-honk
#
#  可选参数：
#    --repo <OWNER/REPO>   指定 Release 所在仓库（也可 export REPO=... 后运行）
#    --keep-dep            不做「剔除 vmlinux-btf」处理，原样安装
#    -h / --help           查看帮助
#    其他位置参数          只安装指定的包，例如: sh -s honk luci-app-honk
#                          （留空则自动安装 honk + luci-app-honk + 中文语言包）
#
#  说明：
#    * 本仓库只发布 OpenWrt apk 包（24.10+ / 25.x 的 apk 体系），
#      不支持 opkg/ipk，检测到 opkg-only 系统会直接退出。
#    * honk 为 eBPF CO-RE 程序，运行依赖内核自带 BTF
#      （/sys/kernel/btf/vmlinux），不依赖 vmlinux-btf 包。
#    * 若 Release 里的包仍然声明了 vmlinux-btf（例如直接抓的上游包），
#      脚本会解开 apk、从 .PKGINFO 的 depend 里删掉它，再重新打包安装，
#      apk 数据库里不会留下未满足依赖。
# ============================================================================

# ↓↓↓ 改成你自己的 GitHub 仓库（OWNER/REPO）↓↓↓
REPO="${REPO:-498777/luci-app-honk}"

# 需要从依赖里剔除的包名，多个用空格分隔；留空则不做剔除
STRIP_DEPS="vmlinux-btf"

# 语言包优先级（按顺序匹配，命中即装）
LANGS="zh-cn zh_Hans zh_cn"

TMPDIR_WORK="${TMPDIR:-/tmp}/honk-install.$$"
PKGS=""

usage() {
    cat <<'EOF'
用法：
  curl -fsSL "https://raw.githubusercontent.com/<OWNER>/<REPO>/main/Auto_Install_Script.sh" | sh -s luci-app-honk

参数：
  --repo <OWNER/REPO>   指定 Release 所在仓库（也可 export REPO=... 后运行）
  --repo=<OWNER/REPO>   同上
  --keep-dep            不剔除 vmlinux-btf 依赖，原样安装
  -h, --help            显示本帮助
  <包名>...             指定要装的包，留空则装 honk + luci-app-honk + 中文语言包
                        （指定 luci-app-honk 时会自动补上 honk 与中文语言包）

示例：
  # 默认装全套
  curl -fsSL .../Auto_Install_Script.sh | sh -s
  # 只装主程序
  curl -fsSL .../Auto_Install_Script.sh | sh -s honk
  # 临时换个仓库
  curl -fsSL .../Auto_Install_Script.sh | sh -s -- --repo someone/luci-app-honk
EOF
    exit 0
}

die() { echo "✗ $*"; exit 1; }
info() { echo "→ $*"; }
ok() { echo "✓ $*"; }

while [ $# -gt 0 ]; do
    case "$1" in
        --repo|-r)     REPO="$2"; shift 2 ;;
        --repo=*)      REPO="${1#--repo=}"; shift ;;
        --keep-dep)    STRIP_DEPS=""; shift ;;
        -h|--help)     usage ;;
        *)             PKGS="$PKGS $1"; shift ;;
    esac
done

echo "╔══════════════════════════════════════════════╗"
echo "║   luci-app-honk 一键安装（apk）              ║"
echo "╚══════════════════════════════════════════════╝"

# ---------------------------------------------------------------- 环境检查
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

# honk 跑在 eBPF CO-RE 上，内核没有 BTF 就起不来，这里先给个明确提示
if [ ! -f /sys/kernel/btf/vmlinux ]; then
    echo "⚠ 未发现 /sys/kernel/btf/vmlinux：当前内核可能未开启 CONFIG_DEBUG_INFO_BTF。"
    echo "  honk 仍能装上，但无法启动。请换用带 BTF 的内核（如官方 24.10+ 默认配置）。"
fi

# ------------------------------------------------------- 拉取 Release 列表
info "查询 Release ..."
API="https://api.github.com/repos/${REPO}/releases?per_page=5"
DATA=$(curl -fsSL --max-time 30 "$API") || die "GitHub API 请求失败，请检查网络或仓库名是否正确"
URLS=$(echo "$DATA" | grep -o 'https://[^"]*\.apk' | sort -u)
[ -n "$URLS" ] || die "该仓库 Release 中没有找到 .apk 文件"

# --------------------------------------------------------- 按名字挑选包
# $1 = 文件名前缀
select_pkg() {
    cands=$(echo "$URLS" | grep -E "/${1}[-_][^\"/]*\.apk$")
    [ -n "$cands" ] || return 1
    best=$(echo "$cands" | grep -i -- "$ARCH" | head -1)
    [ -z "$best" ] && best=$(echo "$cands" | grep -Ei '[-_](all|noarch)[-_.]' | head -1)
    [ -z "$best" ] && best=$(echo "$cands" | head -1)
    echo "$best"
}

# --------------------------------------------- 拆包剔除依赖后重新打包
# 成功返回 0（无论是否真的改过），无法拆分返回 1
strip_apk_dep() {
    f="$1"
    [ -n "$STRIP_DEPS" ] || return 0
    [ -f "$f" ] || return 1

    rm -rf "$TMPDIR_WORK"; mkdir -p "$TMPDIR_WORK" || return 1

    gzip -dc "$f" > "$TMPDIR_WORK/all.tar" 2>/dev/null || { rm -rf "$TMPDIR_WORK"; return 1; }
    # 第一个 gzip 成员是控制段，里面只有 .PKGINFO
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

    # apk = 控制段(gzip) + 数据段(gzip)，解压后是两个首尾相接的 tar。
    # 控制段按 tar 默认记录大小 10240 字节对齐，据此切出数据段。
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

# ------------------------------------------------------------- 安装单个包
install_url() {
    url="$1"
    [ -n "$url" ] || return 1
    file=$(basename "$url")
    info "下载 $file"
    curl -fsSL --max-time 300 --retry 2 -o "/tmp/$file" "$url" || { echo "✗ 下载失败"; return 1; }

    strip_apk_dep "/tmp/$file"

    echo "  ⬇ 安装 $file"
    if apk add --allow-untrusted "/tmp/$file"; then
        :
    else
        echo "  ⚠ 常规安装失败，尝试 --force-broken-world"
        apk add --allow-untrusted --force-broken-world "/tmp/$file" || {
            rm -f "/tmp/$file"; echo "✗ 安装失败"; return 1; }
    fi
    rm -f "/tmp/$file"
    ok "$file 安装完成"
    return 0
}

# --------------------------------------------------------- 计算待装清单
# 按名字挑一个包加进 PLAN
add_pkg() {
    u=$(select_pkg "$1") || u=""
    if [ -n "$u" ]; then
        PLAN="$PLAN $u"
    else
        echo "⚠ 未找到 $1 的 apk，跳过"
        return 1
    fi
}

# 按优先级挑一个中文语言包加进 PLAN
add_i18n() {
    for lang in $LANGS; do
        u=$(select_pkg "luci-i18n-honk-${lang}") || u=""
        if [ -n "$u" ]; then PLAN="$PLAN $u"; return 0; fi
    done
    echo "⚠ 未找到中文语言包，界面将是英文"
    return 1
}

if [ -n "$PKGS" ]; then
    PLAN=""
    want_luci=0
    for p in $PKGS; do
        [ "$p" = "luci-app-honk" ] && want_luci=1
        u=$(select_pkg "$p") || u=""
        [ -n "$u" ] || { echo "✗ 未找到 $p 的 apk，跳过"; continue; }
        PLAN="$PLAN $u"
    done
    # luci-app-honk 依赖 honk，只装界面会让 apk 依赖不满足，这里自动补上
    if [ "$want_luci" -eq 1 ]; then
        echo "$PLAN" | grep -q "/honk-" || add_pkg honk
        add_i18n
    fi
else
    PLAN=""
    add_pkg honk
    add_pkg luci-app-honk
    add_i18n
fi

[ -n "$PLAN" ] || die "没有可安装的包"

echo ""
echo "即将安装："
for u in $PLAN; do echo "  · $(basename "$u")"; done
echo ""

FAILED=""
for u in $PLAN; do
    install_url "$u" || FAILED="$FAILED $(basename "$u")"
done

# ------------------------------------------------------------ 收尾清理
echo ""
info "刷新 LuCI 缓存 ..."
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null
/etc/init.d/rpcd restart    >/dev/null 2>&1
/etc/init.d/uhttpd restart  >/dev/null 2>&1

echo ""
if [ -n "$FAILED" ]; then
    echo "✗ 以下包安装失败：$FAILED"
    exit 1
fi
echo "✅ 完成！"
echo ""
echo "下一步："
echo "  1. LuCI 界面：服务 → honk（若看不到请清浏览器缓存或重新登录）"
echo "  2. 命令行启用：uci set honk.config.enabled=1; uci commit honk; /etc/init.d/honk start"
echo "  3. 首次使用请把 /etc/honk/config.d/node.dae 里的示例节点/订阅替换成自己的"
