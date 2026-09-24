#!/bin/sh
# 校验 po 与 LuCI 源码的一致性。
#
# 规则：po 里每个「实体 msgid」（非头部 msgid ""、非空）都必须能在源码
#       （htdocs/ root/ 下的 *.js *.lua *.json *.uc *.htm *.sh，排除 po/ 与 .git/）
#       里以字面量形式找到；找不到的即「死条目」——通常意味着界面文案已改/已删，
#       而 po 没跟着删，会随版本无限残留。
#
# 用法：
#   scripts/check-po.sh [仓库根，默认取脚本上一级目录]
#
# 豁免：可选 scripts/check-po.ignore，一行一个 msgid（# 开头为注释），
#       用于确实无法字面匹配的条目（动态拼接 / 上游核心文案）。
#
# 退出码：0 = 无死条目；1 = 有死条目。
set -u

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root="${1:-$(dirname -- "$here")}"
ignore="$here/check-po.ignore"

tmp_corpus=$(mktemp) || exit 1
tmp_missing=$(mktemp) || exit 1
trap 'rm -f "$tmp_corpus" "$tmp_missing"' EXIT INT TERM

# 1) 收集源码语料（排除 po/ 与 .git/）
: > "$tmp_corpus"
find "$root" -type f \
     \( -name '*.js' -o -name '*.lua' -o -name '*.json' -o -name '*.uc' \
        -o -name '*.htm' -o -name '*.sh' -o -name '*.init' \) \
     -not -path '*/.git/*' -not -path '*/po/*' 2>/dev/null \
  | while IFS= read -r f; do
        cat "$f" >> "$tmp_corpus"
    done

# 2) 逐个 po 校验
: > "$tmp_missing"
for po in $(find "$root" -type f -name '*.po' -not -path '*/.git/*' | sort); do
    # 取 msgid 正文：先贪婪截取本行首尾引号之间的全部内容，再按 po 的转义规则
    # 还原（反斜杠+引号 -> 引号，双反斜杠 -> 单反斜杠）。不还原的话，含引号的
    # 文案会与源码里的字面量对不上，被误判成死条目。
    sed -n 's/^[[:space:]]*msgid[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' "$po" \
    | sed 's/\\"/"/g; s/\\\\/\\/g' \
    | while IFS= read -r id; do
        [ -n "$id" ] || continue
        if [ -f "$ignore" ] && grep -Fxq -- "$id" "$ignore"; then
            continue
        fi
        grep -Fq -- "$id" "$tmp_corpus" || printf '%s\t%s\n' "$po" "$id"
      done >> "$tmp_missing"
done

if [ -s "$tmp_missing" ]; then
    echo "✗ po 死条目（源码里找不到引用）："
    while IFS='	' read -r po id; do
        printf '  %s :: %s\n' "$po" "$id"
    done < "$tmp_missing"
    n=$(wc -l < "$tmp_missing" | tr -d ' ')
    echo
    echo "共 ${n} 条。确认是动态拼接/上游核心文案的话，登记到 scripts/check-po.ignore；"
    echo "否则从 po 里删掉，让翻译与界面保持一致。"
    exit 1
fi

echo "✓ po 一致性检查通过（无死条目）"
