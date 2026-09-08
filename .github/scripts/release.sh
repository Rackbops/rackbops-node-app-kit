#!/usr/bin/env bash
# .github/scripts/release.sh
#
# Cut a release when publishable code changed since the last v* tag:
#   1. Detect commits since the last release tag that touch src/ (excluding docs) --
#      README/docs/CI-only changes don't warrant a package release.
#   2. Bump the version in package.json.
#   3. Generate a changelog grouped by conventional-commit type.
#   4. Commit the bump, tag vX.Y.Z, and create the GitHub release.
#      The tag push triggers publish.yml, which publishes the package.
#
# Adapted from rackbops-ui-ux-std-lib's .github/scripts/release.sh for a single package
# (one VERSION_FILE, no lockstep-version loop across multiple package.json files).

set -euo pipefail

VERSION_FILE=package.json

# Only commits touching these paths (minus markdown docs) trigger a release
# and appear in the changelog.
PATHSPEC=(src/ ":(exclude,glob)src/**/*.md")

# ── Commit-type display config ────────────────────────────────────────────────

# Ordered list controls section order in the changelog.
COMMIT_TYPES_ORDER=(feat fix perf refactor chore docs style test build ci)

declare -A COMMIT_TYPE_NAMES=(
  [feat]="Features"
  [fix]="Bug Fixes"
  [perf]="Performance"
  [refactor]="Refactoring"
  [chore]="Maintenance"
  [docs]="Documentation"
  [style]="Style"
  [test]="Tests"
  [build]="Build"
  [ci]="CI"
)

# ── Detect unreleased changes ─────────────────────────────────────────────────

last_tag=$(git tag -l "v*" | sort -V | tail -1 || true)

if [[ -n "$last_tag" ]]; then
  commit_log=$(git log "${last_tag}..HEAD" --pretty=format:"%s" -- "${PATHSPEC[@]}" || true)
  commit_bodies=$(git log "${last_tag}..HEAD" --pretty=format:"%B" -- "${PATHSPEC[@]}" || true)
else
  commit_log=$(git log --pretty=format:"%s" -- "${PATHSPEC[@]}" || true)
  commit_bodies=$(git log --pretty=format:"%B" -- "${PATHSPEC[@]}" || true)
fi

if [[ -z "$commit_log" ]]; then
  echo "No unreleased package changes since ${last_tag:-the beginning}. Nothing to do."
  exit 0
fi

# ── Bump version ──────────────────────────────────────────────────────────────
# The bump level comes from the unreleased commit messages (next-version.sh): a
# breaking marker bumps the minor while major is 0; anything else bumps the patch.

current_version=$(node -p "require('./${VERSION_FILE}').version")
new_version=$(.github/scripts/next-version.sh "$current_version" <<< "$commit_bodies")
sed -i "s|\"version\": \"${current_version}\"|\"version\": \"${new_version}\"|" "$VERSION_FILE"
echo "Version: ${current_version} -> ${new_version}"

# ── Build changelog ───────────────────────────────────────────────────────────

declare -A type_entries
for t in "${COMMIT_TYPES_ORDER[@]}"; do type_entries[$t]=""; done
other_entries=""

while IFS= read -r msg; do
  [[ -z "$msg" ]] && continue
  matched=false
  for t in "${COMMIT_TYPES_ORDER[@]}"; do
    # Matches: type(optional-scope)(optional !): description
    # The optional ! keeps breaking commits (feat!:, feat(scope)!:) under their
    # own type instead of dropping them into "Other Changes".
    pattern="^${t}(\([^)]*\))?!?:[[:space:]]+(.+)$"
    if [[ "$msg" =~ $pattern ]]; then
      type_entries[$t]+="- ${BASH_REMATCH[2]}"$'\n'
      matched=true
      break
    fi
  done
  if [[ "$matched" == false ]]; then
    other_entries+="- ${msg}"$'\n'
  fi
done <<< "$commit_log"

notes=""
for t in "${COMMIT_TYPES_ORDER[@]}"; do
  if [[ -n "${type_entries[$t]}" ]]; then
    notes+="### ${COMMIT_TYPE_NAMES[$t]}"$'\n'
    notes+="${type_entries[$t]}"$'\n'
  fi
done
if [[ -n "$other_entries" ]]; then
  notes+="### Other Changes"$'\n'
  notes+="${other_entries}"$'\n'
fi

notes_file=$(mktemp)
printf '%s' "$notes" > "$notes_file"

# ── Commit, tag, and publish ──────────────────────────────────────────────────

tag="v${new_version}"

git add "$VERSION_FILE"
git commit -m "chore(release): ${tag}"
git push

git tag "$tag"
git push origin "$tag"

gh release create "$tag" \
  --title "$tag" \
  --notes-file "$notes_file"

rm -f "$notes_file"

echo "Released ${tag}."
