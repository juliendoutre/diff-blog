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

Serve from the project root (so the app in `public/` can reach the data in `demo/`):

```bash
cd /path/to/diff-blog
python3 -m http.server 8000
```

Then open <http://localhost:8000/public/> in your browser.

Press `Ctrl+C` in the terminal to stop the server.

## URL routing

The app supports deep-linking via the URL path:

```
/<COMMIT_SHA>/<SECTION_INDEX>
```

- `/<COMMIT_SHA>` — opens the chapter for that commit, at the first section (or the last read position if you've visited before).
- `/<COMMIT_SHA>/<SECTION_INDEX>` — opens the chapter at the specified section (0-based).

Navigating within the app updates the URL via `pushState`, so the browser back/forward buttons work as expected.

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
