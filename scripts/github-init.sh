#!/usr/bin/env bash
set -e
REPO="${1:-glimmer-baseball-flywheel}"
echo "Initializing GitHub repo: schererstefan/$REPO"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh repo create "schererstefan/$REPO" --public --source=. --remote=origin --push || echo "gh create fallback: pushing to origin"
else
  echo "gh not authenticated — using SSH remote"
  git remote add origin "git@github.com:schererstefan/$REPO.git" 2>/dev/null || true
fi
git add -A
git commit -m "initial: glimmer baseball flywheel — dataset, web-search judge, SFT/DPO, recursive hill-climb" || echo "nothing to commit"
git push -u origin main || git push -u origin HEAD
echo "Done: https://github.com/schererstefan/$REPO"
