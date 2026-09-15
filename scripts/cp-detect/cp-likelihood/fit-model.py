#!/usr/bin/env python3
"""Fit the crease-pattern likelihood tree table from Rust-produced features.

Input is one or more JSONL files written by
``cargo run --release -p oristudio-cp-detect --example cp_likelihood_features``
over the manifests from ``build-manifest.py`` and ``synth-negatives.py``. Rows
are split 70/30 by an md5 of their path; a gradient-boosted classifier of
shallow trees is fitted on the training rows, reported on the held-out rows,
and the operating threshold is chosen there at ``--target-fpr`` over the
*clean* negatives (folded-model photos, natural photographs, text, diagrams
and every synthetic class — not the noisy "multi-panel" / "blank" / "other"
rejects, which often contain a crease pattern). The shipped table is then
refitted on every labelled row with that threshold and written as
``likelihood_model.rs``, with a ``model.json`` twin and a Markdown report.

The feature order written to the table is fixed here and must match
``likelihood::MODEL_FEATURES``; a Rust unit test fails if it does not.

Needs numpy and scikit-learn (``python3 -m venv .venv && .venv/bin/pip install numpy scikit-learn``).
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import os
import sys

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score

FEATURES = [
    'bg_frac', 'gray_std', 'lattice22', 'top4_mass', 'orient_entropy', 'line_len_norm', 'long_line_ratio',
    'endpoint_rate', 'junction_rate', 'ends_per_junction', 'cells_cv', 'cells_covered', 'ink_frac',
    'img_sat_mean', 'diag_mass', 'ink_to_skel', 'full_span_frac', 'mean_seg_len_norm', 'periodicity', 'n_peaks',
]
CLEAN_NEG = ('neg_folded_model', 'neg_photo', 'neg_wallpaper', 'neg_text', 'neg_diagram')


def is_train(path: str) -> bool:
    return int(hashlib.md5(path.encode()).hexdigest()[:8], 16) % 10 < 7


def is_clean_negative(row: dict) -> bool:
    return row['label'] == 'neg' and (row['group'] in CLEAN_NEG or row['group'].startswith('synth_'))


def load_rows(paths: list[str]) -> list[dict]:
    rows = []
    for p in paths:
        with open(p) as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                if 'error' in row or row.get('label') not in ('pos', 'neg', 'amb'):
                    continue
                rows.append(row)
    return rows


def matrix(rows: list[dict]) -> np.ndarray:
    return np.array([[float(r.get(k, 0.0)) for k in FEATURES] for r in rows], dtype=np.float64)


def labels(rows: list[dict]) -> np.ndarray:
    return np.array([1 if r['label'] == 'pos' else 0 for r in rows], dtype=int)


def fit(rows: list[dict], args) -> GradientBoostingClassifier:
    y = labels(rows)
    # Negatives are the rarer class; weight them so the two halves count equally.
    neg_w = (y == 1).sum() / max((y == 0).sum(), 1)
    w = np.where(y == 1, 1.0, neg_w)
    clf = GradientBoostingClassifier(
        n_estimators=args.trees, max_depth=args.depth, learning_rate=args.learning_rate, init='zero', random_state=0,
    )
    clf.fit(matrix(rows), y, sample_weight=w)
    return clf


def group_rates(rows: list[dict], scores: np.ndarray, thr: float) -> dict[str, float]:
    out = {}
    for group in sorted(set(r['group'] for r in rows)):
        idx = np.array([r['group'] == group for r in rows])
        out[group] = float((scores[idx] >= thr).mean())
    return out


def summarise(rows: list[dict], scores: np.ndarray, thr: float) -> dict:
    y = labels(rows)
    designer = np.array([r['group'].startswith('real/') or r['group'] == 'curated' for r in rows])
    clean = np.array([is_clean_negative(r) for r in rows])
    folded = np.array([r['group'] == 'neg_folded_model' for r in rows])
    synth = np.array([r['label'] == 'neg' and r['group'].startswith('synth_') for r in rows])
    pred = scores >= thr

    def rate(mask):
        return float(pred[mask].mean()) if mask.any() else float('nan')

    return {
        'threshold': thr,
        'recall_all': rate(y == 1),
        'recall_designer_sets': rate(designer),
        'fpr_clean_negatives': rate(clean),
        'fpr_folded_model_photos': rate(folded),
        'fpr_synthetic': rate(synth),
        'fpr_all_negatives': rate(y == 0),
        'n_pos': int((y == 1).sum()),
        'n_clean_neg': int(clean.sum()),
    }


def float_literal(v: float) -> str:
    """Shortest decimal that round-trips to the same f32 (clippy rejects longer ones)."""
    value = np.float32(v)
    if not np.isfinite(value):
        raise ValueError(f'non-finite value in model: {v}')
    text = np.format_float_positional(value, unique=True, trim='-')
    if '.' not in text:
        text += '.0'
    return text


def export_trees(clf: GradientBoostingClassifier) -> tuple[list[tuple], list[int]]:
    nodes: list[tuple] = []
    starts: list[int] = []
    for est in clf.estimators_[:, 0]:
        tree = est.tree_
        starts.append(len(nodes))
        for i in range(tree.node_count):
            if tree.children_left[i] == -1:
                nodes.append((-1, 0.0, 0, 0, float(tree.value[i][0][0])))
            else:
                nodes.append((int(tree.feature[i]), float(tree.threshold[i]), int(tree.children_left[i]),
                              int(tree.children_right[i]), 0.0))
    return nodes, starts


def raw_predict(nodes, starts, lr, X: np.ndarray) -> np.ndarray:
    out = np.zeros(len(X))
    for n, x in enumerate(X):
        raw = 0.0
        for s in starts:
            i = 0
            while True:
                feature, threshold, left, right, value = nodes[s + i]
                if feature < 0:
                    raw += lr * value
                    break
                i = left if np.float32(x[feature]) <= np.float32(threshold) else right
        out[n] = raw
    return out


def write_rust(path: str, clf, thr: float, report: dict, nodes, starts, fit_date: str) -> None:
    lines = [
        '//! GENERATED by `scripts/cp-detect/cp-likelihood/fit-model.py` — do not edit.',
        '//!',
        f'//! Fitted {fit_date} on {report["n_rows"]} labelled rows ({report["n_pos"]} positive), '
        f'{clf.n_estimators} trees of depth {clf.max_depth}, learning rate {clf.learning_rate}.',
        f'//! Held-out AUC {report["auc"]:.4f}. At the threshold below:',
        f'//! recall {report["held_out"]["recall_all"]:.3f} (designer sets {report["held_out"]["recall_designer_sets"]:.3f}), '
        f'FPR {report["held_out"]["fpr_clean_negatives"]:.3f} on clean negatives '
        f'({report["held_out"]["fpr_folded_model_photos"]:.3f} on folded-model photos, '
        f'{report["held_out"]["fpr_synthetic"]:.3f} on synthetic line art).',
        '//! See the README section "Crease-pattern likelihood gate" for how to refit.',
        '',
        '/// Input order; must equal `likelihood::MODEL_FEATURES`.',
        f'pub const FEATURE_NAMES: [&str; {len(FEATURES)}] = [',
    ]
    lines += [f'    "{name}",' for name in FEATURES]
    lines += [
        '];',
        '',
        '/// Probability at or above which the offer is made.',
        f'pub const THRESHOLD: f32 = {float_literal(thr)};',
        'pub const INIT_RAW: f32 = 0.0;',
        f'pub const LEARNING_RATE: f32 = {float_literal(clf.learning_rate)};',
        '',
        '/// `(feature, threshold, left, right, value)`; a leaf has `feature == -1` and',
        '/// `left`/`right` are indices within the same tree. A sample goes left when',
        '/// `x[feature] <= threshold`.',
        'pub type Node = (i16, f32, u16, u16, f32);',
        '#[rustfmt::skip]',
        'pub const NODES: &[Node] = &[',
    ]
    for feature, threshold, left, right, value in nodes:
        lines.append(f'    ({feature}, {float_literal(threshold)}, {left}, {right}, {float_literal(value)}),')
    lines += [
        '];',
        '/// Start offset of each tree in `NODES`.',
        '#[rustfmt::skip]',
        f'pub const TREE_STARTS: &[u32] = &[{", ".join(str(s) for s in starts)}];',
        '',
        '/// Log-odds for a feature vector.',
        f'pub fn raw_score(x: &[f32; {len(FEATURES)}]) -> f32 {{',
        '    let mut raw = INIT_RAW;',
        '    for &start in TREE_STARTS {',
        '        let tree = &NODES[start as usize..];',
        '        let mut i = 0usize;',
        '        loop {',
        '            let (feature, threshold, left, right, value) = tree[i];',
        '            if feature < 0 {',
        '                raw += LEARNING_RATE * value;',
        '                break;',
        '            }',
        '            i = if x[feature as usize] <= threshold {',
        '                left as usize',
        '            } else {',
        '                right as usize',
        '            };',
        '        }',
        '    }',
        '    raw',
        '}',
        '',
    ]
    with open(path, 'w') as out:
        out.write('\n'.join(lines))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--features', nargs='+', required=True, help='feature JSONL files from cp_likelihood_features')
    parser.add_argument('--model-rs', required=True, help='likelihood_model.rs to write')
    parser.add_argument('--model-json', help='JSON twin of the table (default: beside --report)')
    parser.add_argument('--report', help='Markdown report to write')
    parser.add_argument('--trees', type=int, default=100)
    parser.add_argument('--depth', type=int, default=3)
    parser.add_argument('--learning-rate', type=float, default=0.1)
    parser.add_argument('--target-fpr', type=float, default=0.02, help='clean-negative false-positive rate to tune the threshold to')
    parser.add_argument('--threshold', type=float, help='pin the threshold instead of tuning it to --target-fpr')
    args = parser.parse_args()

    rows = load_rows(args.features)
    labelled = [r for r in rows if r['label'] in ('pos', 'neg')]
    ambiguous = [r for r in rows if r['label'] == 'amb']
    train = [r for r in labelled if is_train(r['path'])]
    test = [r for r in labelled if not is_train(r['path'])]
    print(f'{len(labelled)} labelled rows: {len(train)} train / {len(test)} held out; {len(ambiguous)} ambiguous')

    clf = fit(train, args)
    scores = clf.predict_proba(matrix(test))[:, 1]
    y_test = labels(test)
    auc = roc_auc_score(y_test, scores)
    clean = np.array([is_clean_negative(r) for r in test])
    thr = float(np.quantile(scores[clean], 1 - args.target_fpr)) if clean.any() else 0.5
    thr = float(np.clip(thr, 0.5, 0.95))
    if args.threshold is not None:
        thr = args.threshold
    print(f'held-out AUC {auc:.4f}. Operating points:')
    print(f'  {"thr":>5s} {"recall":>7s} {"design":>7s} {"cleanFPR":>9s} {"folded":>7s} {"synth":>6s} {"allneg":>7s}')
    for t in sorted({0.5, 0.6, 0.7, 0.8, 0.85, 0.9, round(thr, 3)}):
        o = summarise(test, scores, t)
        print(f'  {t:5.3f} {o["recall_all"]:7.3f} {o["recall_designer_sets"]:7.3f} {o["fpr_clean_negatives"]:9.3f} '
              f'{o["fpr_folded_model_photos"]:7.3f} {o["fpr_synthetic"]:6.3f} {o["fpr_all_negatives"]:7.3f}')
    held_out = summarise(test, scores, thr)
    print(f'threshold {thr:.3f} ({"pinned" if args.threshold is not None else f"clean-negative FPR {args.target_fpr}"}):')
    for k, v in held_out.items():
        print(f'  {k:26s} {v:.3f}' if isinstance(v, float) else f'  {k:26s} {v}')
    rates = group_rates(test, scores, thr)
    for group, rate in rates.items():
        print(f'    {group:24s} {rate:.2f}')
    importances = sorted(zip(clf.feature_importances_, FEATURES), reverse=True)
    print('importances:', ', '.join(f'{k}:{v:.3f}' for v, k in importances[:10]))

    # The shipped table: everything labelled, same threshold.
    final = fit(labelled, args)
    nodes, starts = export_trees(final)
    X_test = matrix(test)
    check = 1 / (1 + np.exp(-raw_predict(nodes, starts, final.learning_rate, X_test)))
    drift = float(np.abs(check - final.predict_proba(X_test)[:, 1]).max())
    if drift > 1e-4:
        print(f'exported table disagrees with sklearn by {drift}', file=sys.stderr)
        return 1
    amb_scores = {}
    if ambiguous:
        s = final.predict_proba(matrix(ambiguous))[:, 1]
        for group in sorted(set(r['group'] for r in ambiguous)):
            idx = np.array([r['group'] == group for r in ambiguous])
            amb_scores[group] = {'n': int(idx.sum()), 'median': float(np.median(s[idx])), 'offered': float((s[idx] >= thr).mean())}

    fit_date = dt.date.today().isoformat()
    report = {
        'fit_date': fit_date, 'n_rows': len(labelled), 'n_pos': int(labels(labelled).sum()), 'auc': float(auc),
        'trees': args.trees, 'depth': args.depth, 'learning_rate': args.learning_rate, 'target_fpr': args.target_fpr,
        'threshold': thr, 'held_out': held_out, 'held_out_group_rates': rates,
        'importances': [{'feature': k, 'importance': float(v)} for v, k in importances], 'ambiguous': amb_scores,
        'group_counts': dict(collections.Counter(r['group'] for r in labelled)),
    }
    write_rust(args.model_rs, final, thr, report, nodes, starts, fit_date)
    model_json = args.model_json or (os.path.splitext(args.report)[0] + '.model.json' if args.report else None)
    if model_json:
        with open(model_json, 'w') as out:
            json.dump({'features': FEATURES, 'threshold': thr, 'learning_rate': args.learning_rate, 'init_raw': 0.0,
                       'nodes': nodes, 'tree_starts': starts, 'report': report}, out, indent=1)
    if args.report:
        with open(args.report, 'w') as out:
            out.write(f'# Crease-pattern likelihood gate — fit {fit_date}\n\n')
            out.write(f'{len(labelled)} labelled rows, {len(train)} train / {len(test)} held out. '
                      f'{args.trees} trees, depth {args.depth}, learning rate {args.learning_rate}. '
                      f'Held-out AUC {auc:.4f}. Threshold {thr:.3f} (clean-negative FPR {args.target_fpr}).\n\n')
            out.write('| measure | value |\n|---|---|\n')
            for k, v in held_out.items():
                out.write(f'| {k} | {v:.3f} |\n' if isinstance(v, float) else f'| {k} | {v} |\n')
            out.write('\n| group | offered at threshold |\n|---|---|\n')
            for group, rate in rates.items():
                out.write(f'| {group} | {rate:.2f} |\n')
            if amb_scores:
                out.write('\n| ambiguous group | n | median score | offered |\n|---|---|---|---|\n')
                for group, v in amb_scores.items():
                    out.write(f'| {group} | {v["n"]} | {v["median"]:.2f} | {v["offered"]:.2f} |\n')
            out.write('\n| feature | importance |\n|---|---|\n')
            for v, k in importances:
                out.write(f'| {k} | {v:.3f} |\n')
    print(f'wrote {args.model_rs} ({len(nodes)} nodes in {len(starts)} trees)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
