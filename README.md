# Diff Blog

A static web blog that tells a story through git diffs. Each chapter is tied to a commit, and each section highlights a specific file (and optionally a line range) within that commit's diff.

## Project structure

```
public/    Web app (index.html, index.css, index.js)
demo/      Blog data (data.json, diffs/)
```

The web app in `public/` is generic — it loads whatever content is in `demo/`. Swap `demo/` with your own data to tell a different story.

## How it works

- The left column renders the chapter's section text as Markdown.
- The right column renders the git diff for the chapter's commit, loaded from pre-resolved diff files in `demo/diffs/`. The section's `path` selects which file to highlight, and `from`/`to` highlight a specific line range.
- Progress is saved to `localStorage`: sections you've already read stay visible when you return to a chapter.

## Controls

| Key | Action |
|-----|--------|
| ↑ / ↓ | Navigate sections within a chapter (fade transition) |
| ← / → | Navigate between chapters |
| Mouse wheel (left column) | Scroll through sections |
| Mouse wheel (right column) | Scroll through the diff |
| TOC button (top-left) | Toggle the table of contents panel |

## `demo/data.json` schema

```json
{
  "title": "Project name shown in the top bar",
  "repo": "https://github.com/owner/repo",
  "chapters": [
    {
      "title": "Chapter title",
      "commit": "full commit SHA",
      "sections": [
        {
          "content": "Markdown text for this section",
          "path": "path/to/file/to/highlight/in/diff",
          "from": 10,
          "to": 20
        }
      ]
    }
  ]
}
```

- `path` — the file to display from the commit diff. If omitted or empty, all files are shown.
- `from` / `to` — optional line range (in the new version of the file) to highlight within the diff.

## Local development

Stage the same layout as GitHub Pages (`public/` at `/`, `demo/` at `/demo/`), then serve it:

```bash
cd /path/to/diff-blog
mkdir -p staging
cp -r public/* staging/
cp -r demo staging/demo
python3 -m http.server 8000 --directory staging
```

Then open <http://localhost:8000/> in your browser.

Press `Ctrl+C` in the terminal to stop the server.

## URL deep links

Progress is tracked with query parameters so the page path stays stable (important for GitHub Pages base paths):

```
?commit=<COMMIT_SHA>&section=<SECTION_INDEX>
```

- `?commit=<COMMIT_SHA>` — opens the chapter for that commit, resuming the last read section for that chapter if known.
- `?commit=<COMMIT_SHA>&section=<SECTION_INDEX>` — opens the chapter at the specified section (0-based).

Navigating within the app updates the query string via `pushState`, so the browser back/forward buttons work as expected.

## Pre-resolving diffs

Diffs are fetched from the GitHub API ahead of time and stored as JSON files in `demo/diffs/`, one file per commit SHA. This avoids GitHub's API rate limits at runtime.

To generate a diff file for a commit:

```bash
curl -s -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/owner/repo/commits/<SHA> \
  | jq '{sha, files: [.files[] | {filename, status, additions, deletions, patch}]}' \
  > demo/diffs/<SHA>.json
```

Each diff file has this shape:

```json
{
  "sha": "<commit SHA>",
  "files": [
    {
      "filename": "path/to/file",
      "status": "modified",
      "additions": 3,
      "deletions": 0,
      "patch": "@@ -3,6 +3,9 @@\n ..."
    }
  ]
}
```

## Deployment

Push to `main` — the included GitHub Actions workflow stages `public/` and `demo/` into a single directory and deploys to GitHub Pages automatically.
