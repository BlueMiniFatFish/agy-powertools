#!/usr/bin/env bash
set -euo pipefail

# Fetch upstream/main and merge updates into the target branch (defaults to current branch or main).
MODE="merge"
BRANCH=""

for arg in "$@"; do
  case "$arg" in
    --rebase) MODE="rebase" ;;
    *) BRANCH="$arg" ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$BRANCH" == "HEAD" ]] && BRANCH="main"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区存在未提交改动，请先 commit 或 stash 后再同步上游。" >&2
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream https://github.com/WhiteBr1ck/agy-powertools.git
fi

echo "==> 获取 upstream 最新提交与标签..."
git fetch upstream --tags

echo "==> 切至 ${BRANCH} 并通过 ${MODE} 合入 upstream/main..."
git checkout "$BRANCH"
if [[ "$MODE" == "rebase" ]]; then
  git rebase upstream/main
else
  git merge --no-edit upstream/main
fi

echo "==> 同步完成，建议运行 npm test 验证测试套件。"
