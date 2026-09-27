# CMB Quant Dashboard

Public display frontend for `CMB_SCORE_MODEL_V1_1` — subject `600036.SH`
(China Merchants Bank, A-share).

## What this repository is

A **static display layer** for a locally computed quantitative score model.
All computation happens on the local production machine; this repository only
carries the sanitized result artifact and the static frontend that renders it.

- JavaScript here **never computes a score**. It only formats, filters and
  renders values that were already validated locally.
- The local machine is the single source of truth; GitHub is a display mirror.
- No credentials, raw data, internal research material or local paths are
  published here.

## Data files

| File | Meaning |
| --- | --- |
| `data/cmb_score_latest.json` | Latest validated public score artifact |
| `data/index.json` | Index of published trading days |
| `data/history/<YYYY-MM-DD>.json` | One artifact per published trading day |

## Score structure

- **Base Score** — 24 metrics across 5 dimensions, 0–100.
- **Risk Overlay** — 0 to −20, `CMB_BANK_RISK_OVERLAY_V1_1`.
  Currently `NOT_FULLY_AVAILABLE` because two group-scope inputs are not
  publicly disclosed. Missing inputs are never substituted with a
  company-scope proxy and never treated as zero.
- **Final Score** — Base + Overlay. Reported as `NOT_FULLY_AVAILABLE` while the
  overlay inputs remain unavailable. The Base Score stays valid and published.

## Display rules

- Missing values render as `—`, never as `0`.
- Scores are displayed with two decimals.
- The model identifier shown in the UI is `CMB_SCORE_MODEL_V1_1`.

## Schedule

The local scheduler publishes once per A-share trading day at 16:20
(Asia/Shanghai). Missed runs are caught up on the next wake or boot.
