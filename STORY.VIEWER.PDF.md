# Viewer notes: PDF / images / video

## Decision

Keep it simple:

- Files open in normal editor tabs.
- PDF: the tab shows a short guide and an **ext tab** link; the browser's own PDF viewer handles the file.
- Image: full-tab image viewer with wheel/pinch zoom, drag-pan, double-click zoom, and an **ext tab** link. Mobile pinch is supported.
- Video: render a native `<video>` in the tab, plus an **ext tab** link.

No PDF engine is bundled. `pdfjs-dist` was removed; the browser's own PDF support is used. The guide is intentionally generic: Back or edge-swipe works on desktop, iOS Safari, and Android.

## Backend

`GET /api/workspaces/{id}/files/raw?path=...&inline=1&token=...`

- Workspace-scoped: the route selects the workspace root, then `safePath` verifies the path (including symlinks) stays inside that root.
- `ETag` + `Cache-Control: private, max-age=0, must-revalidate`; `http.ServeContent` handles `If-None-Match` and `Range`.
- `inline=1` is allowed for PDF, images, and video; everything else is `Content-Disposition: attachment`.
- PDF/video metadata is returned by `/files/read` without base64, so large files stream instead of hitting the 10 MB JSON cap.

## Browser support

| Browser | External PDF viewer |
|---|---|
| Chrome / Edge desktop | PDFium |
| Firefox desktop | built-in PDF.js |
| Safari macOS | PDFKit / QuickLook |
| iOS Safari | QuickLook; return with edge-swipe |
| Chrome Android | downloads or external viewer; return with system Back |

## Future

Image tabs can support teacher-style sync later (same image/zoom for everyone). PDF stays external-only for now.
