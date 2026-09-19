# Labels

The dataset. `labels.jsonl` lands here from the extension's **Export** button.

## One-time setup

A Chrome extension cannot write to arbitrary paths — it can only download, and
downloads go to Chrome's download directory. So point that directory here:

1. `chrome://settings/downloads`
2. **Location** → Change → pick this folder:
   `C:\Users\LENOVO\shivansh\Unslop\labels`
3. Leave **"Ask where to save each file"** OFF.

Export then writes `labels/unslop/labels.jsonl` in one click, overwriting the
previous file. No dialog, no dated copies piling up in Downloads.

If you would rather not move Chrome's download directory, turn **"Ask where to
save"** on instead and choose this folder each time.

## Collecting

Scroll LinkedIn, expand a row in the panel, rate 1–5. Every rating is stored
immediately in `chrome.storage.local`; Export just copies the whole set out.

Export often. `chrome.storage.local` is per-profile and per-machine — clearing
extension data, switching browsers or reinstalling loses everything that has not
been exported. The file here is the backup, not the browser.

## Format

One JSON object per line:

```json
{
  "postId": "urn:li:activity:7...",
  "text": "the full post text",
  "rating": 4,
  "label": "red",
  "predicted": "yellow",
  "score": 0.58,
  "at": "2026-09-19T12:34:56.789Z",
  "scorerVersion": "rules-2"
}
```

`rating` is the judgment, 1 (great) to 5 (slop). `label` is that collapsed to
the three verdicts — derived, kept for convenience. `predicted` and `score` are
what the rule engine said at the time, which is what makes the disagreement
measurable.

`text` is the field that matters most for training: it lets features be
**recomputed** later, so changing a detector means refitting rather than
re-labeling.

## Git

`*.jsonl` here is gitignored. The dataset is yours, it contains other people's
posts, and it does not belong in a public repo.
