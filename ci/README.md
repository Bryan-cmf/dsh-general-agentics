# CI

`github-actions.yml` is the workflow for this repository, staged outside
`.github/workflows/` because enabling it requires the GitHub token to carry the
`workflow` scope.

## The same gate, locally

```bash
npm run ci        # npm test + npm pack --dry-run — the workflow's two steps
```

`npm run prepublish-check` goes further (it also parses `cordis.patch.yml` with
the runtime's own `js-yaml`, registering DSH's `!!js` tag) and runs on
`npm publish` via `prepublishOnly`.

## Enabling GitHub Actions

With the CLI (needs the scope once):

```bash
gh auth refresh -h github.com -s workflow
mkdir -p .github/workflows
cp ci/github-actions.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable GitHub Actions"
git push
```

Without the scope: open the repository's Actions tab, choose **New workflow**,
**set up a workflow yourself**, and paste the contents of
`ci/github-actions.yml`.
